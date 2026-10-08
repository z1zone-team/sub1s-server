/**
 * KRIC 열차별 운행시각표(subwayTimetableExp) 파싱 및 구간 소요시간 산출 라이브러리
 */

export interface KricTimetableRow {
  railOprIsttCd: string;
  trnNo: string;
  dayCd: string;
  dayNm?: string;
  stinCd: string;
  lnCd: string;
  arvTm?: string | null; // "HHMMSS"
  dptTm?: string | null; // "HHMMSS"
  exptCd?: string | null; // null for regular, '1' for express
}

export interface InterStationDuration {
  fromStinCd: string;
  toStinCd: string;
  isExpress: boolean;
  sampleCount: number;
  durationSec: number;
  minDurationSec: number;
  maxDurationSec: number;
}

/**
 * "HHMMSS" 포맷의 시간 문자열을 자정 기준 초(seconds) 단위 정수로 변환
 */
export function parseTimeToSeconds(timeStr?: string | null): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const clean = timeStr.trim();
  if (clean.length !== 6 || !/^\d{6}$/.test(clean)) return null;

  const h = parseInt(clean.slice(0, 2), 10);
  const m = parseInt(clean.slice(2, 4), 10);
  const s = parseInt(clean.slice(4, 6), 10);

  if (h < 0 || h >= 30 || m < 0 || m >= 60 || s < 0 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/**
 * 출발 시각과 도착 시각 사이의 소요 시간(초) 계산
 * 자정 넘김 처리 (예: 23:58 출발 -> 00:03 도착)
 */
export function calculateDurationSec(
  dptStr?: string | null,
  arvStr?: string | null,
): number | null {
  const dpt = parseTimeToSeconds(dptStr);
  const arv = parseTimeToSeconds(arvStr);
  if (dpt === null || arv === null) return null;

  let diff = arv - dpt;
  if (diff < 0) {
    diff += 86400; // 자정 넘김 보정 (24시간)
  }

  // 1초 이상, 1시간(3600초) 이내의 인접/급행 역간 소요시간만 유효로 판정
  if (diff <= 0 || diff > 3600) return null;
  return diff;
}

/**
 * 숫자 배열의 중위수(Median) 산출 (이상치 필터링)
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 열차 정차 기록
 */
interface TrainStop {
  stinCd: string;
  arvTm?: string | null;
  dptTm?: string | null;
  timeSec: number; // 정렬용 대표 시간 (출발 시각 우선, 없으면 도착 시각)
  exptCd?: string | null;
}

/**
 * KRIC 시각표 레코드 목록을 취합하여 인접 역 간 실제 운행 소요시간(중위수)을 도출
 */
export function analyzeTimetableDurations(
  rows: KricTimetableRow[],
): InterStationDuration[] {
  // 1. 열차 번호(trnNo)별로 정차 기록 그룹화
  const trainsMap = new Map<string, TrainStop[]>();

  for (const row of rows) {
    const dptSec = parseTimeToSeconds(row.dptTm);
    const arvSec = parseTimeToSeconds(row.arvTm);
    const timeSec = dptSec !== null ? dptSec : arvSec;
    if (timeSec === null) continue;

    const stop: TrainStop = {
      stinCd: row.stinCd,
      arvTm: row.arvTm,
      dptTm: row.dptTm,
      timeSec,
      exptCd: row.exptCd,
    };

    const list = trainsMap.get(row.trnNo);
    if (list) {
      list.push(stop);
    } else {
      trainsMap.set(row.trnNo, [stop]);
    }
  }

  // 2. 각 열차 내에서 시간 순서대로 정렬 후 연속 정차역 간 소요시간 수집
  // key: `${fromStinCd}->${toStinCd}:${isExpress ? 'EXP' : 'REG'}`
  const durationsMap = new Map<
    string,
    {
      fromStinCd: string;
      toStinCd: string;
      isExpress: boolean;
      durations: number[];
    }
  >();

  for (const [, stops] of trainsMap) {
    // 새벽 열차 및 일반 정렬 (시간순)
    stops.sort((a, b) => {
      // 00~03시 새벽 운행 열차의 경우 24시 이후로 취급
      const aAdj = a.timeSec < 14400 ? a.timeSec + 86400 : a.timeSec;
      const bAdj = b.timeSec < 14400 ? b.timeSec + 86400 : b.timeSec;
      return aAdj - bAdj;
    });

    // 급행 열차의 경우 통과역(arvTm === null이며 최초 출발역이 아닌 역)은 승하차 정차역에서 제외
    const effectiveStops: TrainStop[] = [];
    for (let idx = 0; idx < stops.length; idx += 1) {
      const s = stops[idx];
      const isExpress = Boolean(s.exptCd);
      if (isExpress) {
        const isStop =
          (s.arvTm !== null && s.dptTm !== null) ||
          (idx === 0 && s.dptTm !== null) ||
          (idx === stops.length - 1 && s.arvTm !== null);
        if (isStop) {
          effectiveStops.push(s);
        }
      } else {
        effectiveStops.push(s);
      }
    }

    for (let i = 0; i < effectiveStops.length - 1; i += 1) {
      const from = effectiveStops[i];
      const to = effectiveStops[i + 1];

      // 동일 역 연속 중복 방어
      if (from.stinCd === to.stinCd) continue;

      // 출발 시각(from.dptTm)에서 도착 시각(to.arvTm)까지의 실 주행 소요시간 계산
      // 만약 종착/출발역이라 한쪽이 null이면 사용 가능한 시각으로 폴백
      const dpt = from.dptTm || from.arvTm;
      const arv = to.arvTm || to.dptTm;
      const duration = calculateDurationSec(dpt, arv);
      if (duration === null) continue;

      const isExpress = Boolean(from.exptCd || to.exptCd);
      const key = `${from.stinCd}->${to.stinCd}:${isExpress ? 'EXP' : 'REG'}`;

      let entry = durationsMap.get(key);
      if (!entry) {
        entry = {
          fromStinCd: from.stinCd,
          toStinCd: to.stinCd,
          isExpress,
          durations: [],
        };
        durationsMap.set(key, entry);
      }
      entry.durations.push(duration);
    }
  }

  // 3. 통계 집계 (중위수, 최소/최대)
  const results: InterStationDuration[] = [];

  for (const entry of durationsMap.values()) {
    if (entry.durations.length === 0) continue;
    const sorted = [...entry.durations].sort((a, b) => a - b);
    results.push({
      fromStinCd: entry.fromStinCd,
      toStinCd: entry.toStinCd,
      isExpress: entry.isExpress,
      sampleCount: sorted.length,
      durationSec: calculateMedian(sorted),
      minDurationSec: sorted[0],
      maxDurationSec: sorted[sorted.length - 1],
    });
  }

  return results;
}
