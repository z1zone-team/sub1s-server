import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { RouteMode } from '../../../domain/subway/models/route';
import { classifyAddressQuery } from '../../../infra/place/address-query';
import { SubwayGraphService } from '../../../domain/subway/services/subway-graph.service';
import { InterpretedIntentDto } from '../dto/voice-route-recommend-response.dto';
import { StationNameMatcher } from './station-name-matcher';

/** 출발지를 말하지 않았을 때 의도에 쓰는 표시 이름 */
export const CURRENT_LOCATION = '현재 위치';
/** 사용자가 저장한 집과 학교를 가리키는 의도 이름. 역 이름이 아니라 저장한 장소로 풀어야 한다 */
export const HOME_PLACE = '집';
export const SCHOOL_PLACE = '학교';
export const SAVED_PLACE_NAMES: readonly string[] = [HOME_PLACE, SCHOOL_PLACE];

/**
 * `집`, `학교`(앞에 `우리`, `내`가 붙을 수 있다)와 바로 뒤의 표지. 표지가 없으면 한글이 이어지지 않아야 한다
 * (`모집`, `집중`, `학교생활`을 장소로 보지 않기 위해서). 서울 지하철 역 이름에는 `집`, `학교`가 없어 역 이름과 겹치지 않는다
 */
const SAVED_PLACE_WORD =
  /(?<![가-힣])(?:우리\s*|내\s*)?(집|학교)(?:(에서|부터|으로|로|까지|가는|가자|갈래|가고|에)|(?![가-힣]))/g;
const PLACE_ORIGIN_MARKERS = ['에서', '부터'];

// 경로 조건을 말하는 표현. 앞에 있는 것부터 본다(`환승 적고 빠른 길`은 환승 적은 경로)
// `붐비`는 받아 적기에서 `분비`, `붕비`로 자주 바뀐다(2026-11-26 AVD 기기 인식, Gemini 오디오 모두 `덜 분비는`)
const COMFORTABLE_WORDS =
  /(여유|편한|편하게|자리|앉아|쾌적|덜\s*[붐분붕]비|안\s*[붐분붕]비|한산|덜\s*혼잡|혼잡하지\s*않|사람(?:이)?\s*(?:적|없|별로\s*없))/;
const CHEAPEST_WORDS =
  /(최소\s*비용|저렴|제일\s*싼|가장\s*싼|알뜰|요금\s*절약)/;
const PERSONAL_WORDS = /(취향|맞춤|내\s*스타일|평소|자주\s*가던)/;
const FEWEST_TRANSFERS_WORDS =
  /(환승\s*(?:을|이)?\s*(?:적|없|덜|안\s*하|최소|한\s*번)|갈아타(?:지\s*않|는\s*거\s*(?:적|싫)|기\s*(?:적|싫))|덜\s*갈아타|안\s*갈아타|한\s*번에\s*가)/;
const LEAST_WALK_WORDS =
  /(덜\s*걷|적게\s*걷|조금\s*걷|안\s*걷|걷기\s*(?:싫|적)|걷는\s*(?:거|게|길)\s*(?:적|싫|짧)|도보\s*(?:가\s*)?(?:적|최소|짧))/;
const FASTEST_WORDS =
  /(빠른|빠르게|빨리|최단\s*시간|시간\s*(?:이\s*)?(?:적게|짧게|덜)|급해|급하게|서둘러)/;

// 장소 이름이 아니라 경로 조건을 말한 구절("편한 길로")은 도착지로 넘기지 않는다
const MODE_WORDS = new RegExp(
  [
    COMFORTABLE_WORDS,
    /(싼|요금)/,
    CHEAPEST_WORDS,
    PERSONAL_WORDS,
    FEWEST_TRANSFERS_WORDS,
    LEAST_WALK_WORDS,
    FASTEST_WORDS,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
);

// 역 이름으로 풀리지 않는 출발 구절이 이 길이 이상이어야 장소 이름으로 본다(짧은 것은 역 이름을 잘못 알아들은 것으로 보고 알린다)
const MIN_PLACE_ORIGIN = 4;

// 출발을 현재 위치로 말한 구절("여기에서", "지금 위치에서")은 장소 이름으로 넘기지 않는다
const CURRENT_LOCATION_WORD = /(?:여기|지금|현재|이곳|내\s*위치)/;

// 장소 이름이나 주소 뒤에 붙는 말("가자", "가는 길 알려줘")과 조사를 뗄 때 쓴다
const TRAILING_REQUEST =
  /\s*(?:가는\s*길|가자|가줘|가고\s*싶|갈래|길\s*안내|안내|알려\s*줘|찾아\s*줘).*$/;

// 역 이름 바로 뒤에 와도 낱말이 끝난 것으로 보는 말(역, 조사, 방향 표현, 공백이나 기호)
const STATION_WORD_END =
  /^(?:역|에서|에|으로|로|까지|부터|가는|가자|가줘|갈래|가고|길|은|는|이|가|을|를|도|쪽|근처|부근|앞|방면|[^가-힣])/;

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
    // 0. 저장한 집이나 학교를 말했으면("집으로 가자", "집에서 강남까지") 그 장소로 해석한다
    const places = this.extractSavedPlaces(text);
    if (places) return places;

    // 1. "A에서 B까지" 꼴이면 표지로 출발 구간과 도착 구간을 나눠 구간마다 가장 가까운 역을 찾는다.
    //    구간 안에서는 공백을 지우고 비교한다(Whisper는 이름 안에 공백을 넣기도 한다: `광흥 창역`, `동두천 중앙`).
    //    정확히 일치하는 이름은 거리 0이라 같은 결과이고, 이름을 잘못 알아들은 경우만 보정된다
    const corrected = this.resolveAroundMarkers(text.replace(/\s+/g, ''), text);
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
      // `명지대학교`의 `명지대`, `강남대로`의 `강남`처럼 역 이름이 더 긴 낱말의 앞부분일 뿐이면 역이 아니라 장소다
      if (!/(?:에서|부터)/.test(text)) {
        const place = this.placeNameAround(text, only);
        if (place) return { originStationName: null, destStationName: place };
      }
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

    // 역은 없지만 주소를 말했으면("문화로 67-1 가는 길") 그 주소가 도착지다
    const address = this.addressIn(text);
    if (address) return { originStationName: null, destStationName: address };

    this.logger.warn(`Could not extract stations from: "${text}"`);
    throw new BusinessException(
      'VOICE_INTENT_NOT_UNDERSTOOD',
      '어디로 갈지 알아듣지 못했어요. 역 이름을 말씀해 주세요.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * "집으로 가자", "학교 가는 길", "집에서 강남까지", "강남에서 집으로", "집에서 학교까지"처럼
   * 저장한 집이나 학교를 말한 경우를 해석한다. 장소가 없으면 null이라 역 이름 해석으로 넘어간다.
   * `에서`, `부터`가 붙으면 출발, 그 밖(`으로`, `까지`, `가는`, 표지 없음)은 도착이다
   */
  private extractSavedPlaces(text: string): {
    originStationName: string | null;
    destStationName: string;
  } | null {
    let origin: string | null = null;
    let dest: string | null = null;
    for (const match of text.matchAll(SAVED_PLACE_WORD)) {
      const name = match[1] === '집' ? HOME_PLACE : SCHOOL_PLACE;
      if (match[2] && PLACE_ORIGIN_MARKERS.includes(match[2])) origin ??= name;
      else dest ??= name;
    }
    if (!origin && !dest) return null;
    if (origin && origin === dest) throw this.notUnderstood();

    if (origin && dest) {
      return { originStationName: origin, destStationName: dest };
    }

    // 장소가 하나면 나머지 한쪽은 문장에서 역을 찾는다
    const rest = text.replace(SAVED_PLACE_WORD, ' ');
    const station = this.stationIn(rest);
    if (origin) {
      if (!station) throw this.notUnderstood();
      return { originStationName: origin, destStationName: station };
    }
    // 도착이 장소이고 역이 있으면 "강남에서 집으로"처럼 출발 표지가 있을 때만 출발역으로 본다
    const stationIsOrigin = station !== null && /(?:에서|부터)/.test(rest);
    return {
      originStationName: stationIsOrigin ? station : null,
      destStationName: dest!,
    };
  }

  /** 장소를 뗀 나머지 문장에서 역 하나를 찾는다. 정확한 이름을 먼저, 없으면 가장 가까운 역으로 보정한다 */
  private stationIn(rest: string): string | null {
    const exact = this.findKnownStationsInText(rest);
    if (exact.length > 0) return exact[0];

    const compact = rest
      .replace(/\s+/g, '')
      .split(/에서|부터|까지|으로|가는|가자|길/)[0]
      .replace(/로$/, '');
    if (!compact) return null;
    return this.stationMatcher().closestAtEnd(compact)?.name ?? null;
  }

  private notUnderstood(): BusinessException {
    return new BusinessException(
      'VOICE_INTENT_NOT_UNDERSTOOD',
      '어디로 갈지 알아듣지 못했어요. 역 이름을 말씀해 주세요.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** 출발 표지("에서", "부터")가 있는데 그 앞이 현재 위치를 뜻하는 말이 아닌지 */
  private saidUnresolvedOrigin(text: string): boolean {
    if (!/(?:에서|부터)/.test(text)) return false;
    return !/(?:여기|지금|현재|이곳|내\s*위치)\s*(?:에서|부터)?/.test(
      text.split(/에서|부터/)[0] + '에서',
    );
  }

  /**
   * "A역에서 B역까지" 꼴에서 표지(에서, 부터, 까지, 으로) 앞의 이름을 역 사전에서 가장 가까운 역으로 찾습니다.
   * 두 역을 모두 찾고 서로 다를 때만 돌려줍니다. 찾지 못하면 null이라 기존 방식으로 넘어갑니다.
   */
  private resolveAroundMarkers(
    compact: string,
    original: string,
  ): {
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
    // 도착으로 말한 구절이 주소이거나 역 이름으로 풀리지 않으면, 출발역은 풀렸다는 조건에서 말한 구절을 그대로
    // 도착지(장소 이름이나 주소)로 넘긴다. 서버가 장소 검색으로 후보를 찾는다
    const spoken = origin ? this.spokenDestination(original) : null;
    if (origin && spoken && classifyAddressQuery(spoken) !== 'PLACE') {
      return { originStationName: origin.name, destStationName: spoken };
    }
    const dest = matcher.closestAtEnd(destRegion);
    if (origin && !dest && spoken && !MODE_WORDS.test(spoken)) {
      return { originStationName: origin.name, destStationName: spoken };
    }
    // 출발 구절이 주소이거나 역 이름으로 풀리지 않으면 말한 구절을 그대로 출발지로 넘긴다(도착지와 같은 방식)
    const spokenFrom = this.spokenOrigin(original);
    if (
      spokenFrom &&
      (classifyAddressQuery(spokenFrom) !== 'PLACE' ||
        (!origin &&
          spokenFrom.replace(/\s+/g, '').length >= MIN_PLACE_ORIGIN)) &&
      !CURRENT_LOCATION_WORD.test(spokenFrom) &&
      !MODE_WORDS.test(spokenFrom)
    ) {
      if (dest) {
        return { originStationName: spokenFrom, destStationName: dest.name };
      }
      const spokenTo = this.spokenDestination(original);
      if (spokenTo && !MODE_WORDS.test(spokenTo)) {
        return { originStationName: spokenFrom, destStationName: spokenTo };
      }
    }
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

  /** 장소 이름이나 주소 뒤의 요청 말("가자", "가는 길 알려줘")과 "으로", "까지", "로"를 뗀다 */
  private trimDestinationPhrase(phrase: string): string {
    return phrase
      .replace(TRAILING_REQUEST, '')
      .replace(/(?:으로|까지|로)\s*$/, '')
      .trim();
  }

  /** 출발 표지("에서", "부터") 앞에서 출발로 말한 구절을 공백을 살려 돌려준다. 두 글자 미만이면 null */
  private spokenOrigin(text: string): string | null {
    const marker = /역?(?:에서|부터)/.exec(text);
    if (!marker) return null;
    const phrase = text.slice(0, marker.index).trim();
    return phrase.length >= 2 ? phrase : null;
  }

  /** 출발 표지("에서", "부터") 뒤에서 도착으로 말한 구절을 공백을 살려 돌려준다. 두 글자 미만이면 null */
  private spokenDestination(text: string): string | null {
    const marker = /역?(?:에서|부터)/.exec(text);
    if (!marker) return null;
    const phrase = this.trimDestinationPhrase(
      text.slice(marker.index + marker[0].length),
    );
    return phrase.length >= 2 ? phrase : null;
  }

  /**
   * 사전에서 찾은 역 이름이 더 긴 낱말의 앞부분일 뿐이면(`명지대학교`의 `명지대`, `강남대로`의 `강남`)
   * 그 낱말부터 도착 표지까지를 장소 이름으로 돌려준다. 낱말 끝이 맞으면(`강남역`, `강남으로`) null이다
   */
  private placeNameAround(text: string, station: string): string | null {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(station, from);
      if (index < 0) return null;
      const after = text.slice(index + station.length);
      if (after !== '' && !STATION_WORD_END.test(after)) {
        const start = text.lastIndexOf(' ', index) + 1;
        const phrase = this.trimDestinationPhrase(text.slice(start));
        return phrase.length >= 2 ? phrase : null;
      }
      from = index + 1;
    }
    return null;
  }

  /** 역 없이 주소만 말한 문장에서 주소를 돌려준다(도로명이나 지번 주소가 아니면 null) */
  private addressIn(text: string): string | null {
    const phrase = this.trimDestinationPhrase(text);
    return classifyAddressQuery(phrase) === 'PLACE' ||
      classifyAddressQuery(phrase) === 'NUMBER_ONLY'
      ? null
      : phrase;
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
    if (COMFORTABLE_WORDS.test(text)) {
      return {
        mode: 'COMFORTABLE',
        reason: '혼잡도가 낮고 여유로운 좌석 우선 경로를 감지했습니다.',
      };
    }
    if (CHEAPEST_WORDS.test(text)) {
      return {
        mode: 'CHEAPEST',
        reason:
          '환승 및 요금 기준 가장 경제적인 최소 비용 경로를 감지했습니다.',
      };
    }
    if (PERSONAL_WORDS.test(text)) {
      return {
        mode: 'PERSONAL',
        reason: '사용자 통근 성향 및 개인 맞춤형 경로를 감지했습니다.',
      };
    }
    if (FEWEST_TRANSFERS_WORDS.test(text)) {
      return {
        mode: 'FEWEST_TRANSFERS',
        reason: '환승 횟수가 가장 적은 경로를 감지했습니다.',
      };
    }
    if (LEAST_WALK_WORDS.test(text)) {
      return {
        mode: 'LEAST_WALK',
        reason: '걷는 거리가 가장 짧은 경로를 감지했습니다.',
      };
    }
    if (FASTEST_WORDS.test(text)) {
      return {
        mode: 'FASTEST',
        reason: '소요 시간이 가장 짧은 경로를 감지했습니다.',
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
