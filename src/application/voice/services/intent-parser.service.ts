import { Injectable, Logger } from '@nestjs/common';
import { RouteMode } from '../../../domain/subway/models/route';
import { SubwayGraphService } from '../../../domain/subway/services/subway-graph.service';
import { InterpretedIntentDto } from '../dto/voice-route-recommend-response.dto';

@Injectable()
export class IntentParserService {
  private readonly logger = new Logger(IntentParserService.name);

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
      originStationName: stations.originStationName,
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
    originStationName: string;
    destStationName: string;
  } {
    // 1. 역명 사전 기반 검색 (가장 긴 역명 우선 매칭)
    const matchedStations = this.findKnownStationsInText(text);
    if (matchedStations.length >= 2) {
      return {
        originStationName: matchedStations[0],
        destStationName: matchedStations[1],
      };
    }

    // 2. 패턴 매칭: [출발]역?에서/부터 [도착]역?까지/로/으로
    const regexFromTo =
      /([가-힣0-9a-zA-Z]+?)(?:역에서|역부터|에서|부터)\s+([가-힣0-9a-zA-Z]+?)(?:역까지|역으로|역로|까지|으로|로)/;
    const matchFromTo = text.match(regexFromTo);
    if (matchFromTo) {
      const originCandidate = this.normalizeStationName(matchFromTo[1]);
      const destCandidate = this.normalizeStationName(matchFromTo[2]);
      if (originCandidate && destCandidate && originCandidate !== destCandidate) {
        return {
          originStationName: originCandidate,
          destStationName: destCandidate,
        };
      }
    }

    // 3. 패턴 매칭: [출발] -> [도착] 또는 [출발] [도착]
    const arrowMatch = /([가-힣0-9a-zA-Z]+?)(?:\s*(?:->|~)\s*)([가-힣0-9a-zA-Z]+)/.exec(text);
    if (arrowMatch) {
      const originCandidate = this.normalizeStationName(arrowMatch[1]);
      const destCandidate = this.normalizeStationName(arrowMatch[2]);
      if (originCandidate && destCandidate && originCandidate !== destCandidate) {
        return {
          originStationName: originCandidate,
          destStationName: destCandidate,
        };
      }
    }

    // 기본 매칭 (알 수 없는 경우 대표 역 기본값)
    this.logger.warn(`Could not reliably extract stations from: "${text}". Using fallback.`);
    return {
      originStationName: '강남',
      destStationName: '을지로입구',
    };
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
        reason: '환승 및 요금 기준 가장 경제적인 최소 비용 경로를 감지했습니다.',
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
        const overlaps = matches.some(
          (m) => !(end <= m.start || idx >= m.end),
        );

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
