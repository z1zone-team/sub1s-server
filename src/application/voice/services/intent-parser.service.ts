import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { RouteMode } from '../../../domain/subway/models/route';
import { SubwayGraphService } from '../../../domain/subway/services/subway-graph.service';
import { InterpretedIntentDto } from '../dto/voice-route-recommend-response.dto';
import { StationNameMatcher } from './station-name-matcher';

/** 출발지를 말하지 않았을 때 의도에 쓰는 표시 이름 */
export const CURRENT_LOCATION = '현재 위치';

@Injectable()
export class IntentParserService {
  private readonly logger = new Logger(IntentParserService.name);
  private matcher?: StationNameMatcher;

  constructor(private readonly graphService: SubwayGraphService) {}

  /**
   * 전사 텍스트와 요청 파라미터로부터 사용자 의도를 결정론적으로 추출합니다.
   */
  parseIntent(
    transcript: string,
    overrideMode?: RouteMode,
  ): InterpretedIntentDto {
    const cleaned = transcript.trim();

    // 1. 모드 추출
    const detectedMode = this.detectMode(cleaned);
    const finalMode: RouteMode = overrideMode ?? detectedMode.mode;

    // 2. 출발역 및 도착역 추출
    const stations = this.extractStations(cleaned);

    return {
      originStationName: stations.originStationName ?? CURRENT_LOCATION,
      destStationName: stations.destStationName,
      preferredMode: finalMode,
      reason: overrideMode
        ? `사용자 지정 우선 모드(${overrideMode})가 적용되었습니다.`
        : detectedMode.reason,
    };
  }

  /**
   * 자연어 텍스트에서 출발역과 도착역을 정규식 및 역명 사전을 통해 추출합니다.
   */
  private extractStations(text: string): {
    originStationName: string | null;
    destStationName: string;
  } {
    // 1. "A에서 B까지" 꼴이면 표지로 출발 구간과 도착 구간을 나눠 구간마다 가장 가까운 역을 찾는다.
    //    구간 안에서는 공백을 지우고 비교한다(Whisper는 이름 안에 공백을 넣기도 한다: `광흥 창역`, `동두천 중앙`).
    //    정확히 일치하는 이름은 거리 0이라 같은 결과이고, 이름을 잘못 알아들은 경우만 보정된다
    const corrected = this.resolveAroundMarkers(text.replace(/\s+/g, ''));
    if (corrected) return corrected;

    // 2. 역명 사전 기반 검색 (가장 긴 역명 우선 매칭)
    // 공백을 지우지 않은 원래 문장에서 찾는다. 지우면 단어 경계를 넘는 우연한 일치가 생긴다(`홍제에서 초당` → `에서초당`의 `서초`)
    const matchedStations = this.findKnownStationsInText(text);
    if (matchedStations.length >= 2) {
      return {
        originStationName: matchedStations[0],
        destStationName: matchedStations[1],
      };
    }

    // 도착지 하나만 말한 경우("강남역 가는 길")는 출발지를 현재 위치로 둔다
    if (matchedStations.length === 1) {
      const only = matchedStations[0];
      const originOnly = new RegExp(`${only}역?\s*(?:에서|부터)`).test(text);
      if (!originOnly) {
        // "에서"를 말했는데 출발역을 찾지 못했으면(이름을 잘못 알아들은 것) 조용히 현재 위치에서 출발한 것으로
        // 처리하지 않고 알아듣지 못했다고 알린다. "여기에서", "지금" 같은 현재 위치 표현은 그대로 둔다
        if (this.saidUnresolvedOrigin(text)) {
          throw new BusinessException(
            'VOICE_INTENT_NOT_UNDERSTOOD',
            '출발역을 알아듣지 못했어요. 역 이름을 또박또박 말씀해 주세요.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        return { originStationName: null, destStationName: only };
      }
    }

    // 2. 패턴 매칭: [출발]역?에서/부터 [도착]역?까지/로/으로
    const regexFromTo =
      /([가-힣0-9a-zA-Z]+?)(?:역에서|역부터|에서|부터)\s+([가-힣0-9a-zA-Z]+?)(?:역까지|역으로|역로|까지|으로|로)/;
    const matchFromTo = text.match(regexFromTo);
    if (matchFromTo) {
      const originCandidate = this.normalizeStationName(matchFromTo[1]);
      const destCandidate = this.normalizeStationName(matchFromTo[2]);
      if (
        originCandidate &&
        destCandidate &&
        originCandidate !== destCandidate
      ) {
        return {
          originStationName: originCandidate,
          destStationName: destCandidate,
        };
      }
    }

    // 3. 패턴 매칭: [출발] -> [도착] 또는 [출발] [도착]
    const arrowMatch =
      /([가-힣0-9a-zA-Z]+?)(?:\s*(?:->|~)\s*)([가-힣0-9a-zA-Z]+)/.exec(text);
    if (arrowMatch) {
      const originCandidate = this.normalizeStationName(arrowMatch[1]);
      const destCandidate = this.normalizeStationName(arrowMatch[2]);
      if (
        originCandidate &&
        destCandidate &&
        originCandidate !== destCandidate
      ) {
        return {
          originStationName: originCandidate,
          destStationName: destCandidate,
        };
      }
    }

    this.logger.warn(`Could not extract stations from: "${text}"`);
    throw new BusinessException(
      'VOICE_INTENT_NOT_UNDERSTOOD',
      '어디로 갈지 알아듣지 못했어요. 역 이름을 말씀해 주세요.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** 출발 표지("에서", "부터")가 있는데 그 앞이 현재 위치를 뜻하는 말이 아닌지 */
  private saidUnresolvedOrigin(text: string): boolean {
    if (!/(?:에서|부터)/.test(text)) return false;
    return !/(?:여기|지금|현재|이곳|내\s*위치)\s*(?:에서|부터)?/.test(text.split(/에서|부터/)[0] + '에서');
  }

  /**
   * "A역에서 B역까지" 꼴에서 표지(에서, 부터, 까지, 으로) 앞의 이름을 역 사전에서 가장 가까운 역으로 찾습니다.
   * 두 역을 모두 찾고 서로 다를 때만 돌려줍니다. 찾지 못하면 null이라 기존 방식으로 넘어갑니다.
   */
  private resolveAroundMarkers(compact: string): {
    originStationName: string;
    destStationName: string;
  } | null {
    const originMarker = /역?(?:에서|부터)/.exec(compact);
    if (!originMarker) return null;

    const originRegion = compact.slice(0, originMarker.index);
    const rest = compact.slice(originMarker.index + originMarker[0].length);
    const destEnd = this.destinationEnd(rest);
    if (destEnd < 0) return null;
    const destRegion = rest.slice(0, destEnd);

    const matcher = this.stationMatcher();
    const origin = matcher.closestAtEnd(originRegion);
    const dest = matcher.closestAtEnd(destRegion);
    if (!origin || !dest || origin.name === dest.name) return null;

    for (const [said, found] of [
      [originRegion, origin],
      [destRegion, dest],
    ] as const) {
      if (found.distance > 0) {
        this.logger.log(
          `Corrected station in voice text: "${said}" -> "${found.name}" (distance ${found.distance})`,
        );
      }
    }
    return {
      originStationName: origin.name,
      destStationName: dest.name,
    };
  }

  /** 도착 구간이 끝나는 위치. "까지"를 먼저 보고, 없으면 "으로", 마지막으로 "로" */
  private destinationEnd(rest: string): number {
    for (const end of ['까지', '으로']) {
      const index = rest.indexOf(end);
      if (index > 0) return index;
    }
    return rest.lastIndexOf('로');
  }

  private stationMatcher(): StationNameMatcher {
    if (!this.matcher) {
      const graph = this.graphService.getGraph();
      const names: string[] = [];
      for (let i = 0; i < graph.stationCount; i++) {
        const pure = this.normalizeStationName(graph.station(i).stationName);
        if (pure.length >= 2) names.push(pure);
      }
      this.matcher = new StationNameMatcher(names);
    }
    return this.matcher;
  }

  /**
   * 자연어 텍스트에서 모드와 판단 사유를 추론합니다.
   */
  private detectMode(text: string): { mode: RouteMode; reason: string } {
    if (/(여유|편한|편하게|자리|앉아|쾌적|덜\s*붐비)/.test(text)) {
      return {
        mode: 'COMFORTABLE',
        reason: '혼잡도가 낮고 여유로운 좌석 우선 경로를 감지했습니다.',
      };
    }
    if (/(최소\s*비용|저렴|제일\s*싼|가장\s*싼|알뜰|요금\s*절약)/.test(text)) {
      return {
        mode: 'CHEAPEST',
        reason:
          '환승 및 요금 기준 가장 경제적인 최소 비용 경로를 감지했습니다.',
      };
    }
    if (/(취향|맞춤|내\s*스타일|평소|자주\s*가던)/.test(text)) {
      return {
        mode: 'PERSONAL',
        reason: '사용자 통근 성향 및 개인 맞춤형 경로를 감지했습니다.',
      };
    }
    return {
      mode: 'OPTIMAL',
      reason: '소요 시간과 환승 횟수를 종합 고려한 최적 경로를 추천합니다.',
    };
  }

  /**
   * 역 이름 끝의 '역' 제거 및 정규화
   */
  normalizeStationName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.endsWith('역') && trimmed.length > 1) {
      return trimmed.slice(0, -1);
    }
    return trimmed;
  }

  /**
   * 문장 내에 존재하는 실제 전철역 이름을 순서대로 검색합니다.
   */
  private findKnownStationsInText(text: string): string[] {
    const graph = this.graphService.getGraph();
    const candidateNames = new Set<string>();

    for (let i = 0; i < graph.stationCount; i++) {
      const record = graph.station(i);
      const pureName = this.normalizeStationName(record.stationName);
      if (pureName.length >= 2) {
        candidateNames.add(pureName);
      }
    }

    // 긴 이름 우선 정렬 (예: '을지로입구' > '을지로')
    const sortedNames = Array.from(candidateNames).sort(
      (a, b) => b.length - a.length,
    );

    const matches: { name: string; start: number; end: number }[] = [];

    for (const name of sortedNames) {
      let searchPos = 0;
      while (searchPos < text.length) {
        const idx = text.indexOf(name, searchPos);
        if (idx === -1) break;

        const end = idx + name.length;
        // 이미 매칭된 구간과 겹치는지 검사
        const overlaps = matches.some((m) => !(end <= m.start || idx >= m.end));

        if (!overlaps) {
          matches.push({ name, start: idx, end });
        }
        searchPos = idx + 1;
      }
    }

    // 문장 내 등장 순서대로 정렬
    matches.sort((a, b) => a.start - b.start);
    return matches.map((m) => m.name);
  }
}
