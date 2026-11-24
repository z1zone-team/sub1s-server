/**
 * 계단 축 자료(station-vertical.json)를 만드는 순수 함수.
 * KRIC 역사별 엘리베이터 이동동선 글의 층 표기로 경로가 지나는 층 순서를 읽고, 오르내린 층 수를 센다.
 * 설계: docs STAIRS_AXIS_DESIGN.md
 */

/** 층 번호: 1F=0, 2F=1, B1=-1. 1F와 B1 사이에 0층이 없어서 이렇게 해야 한 층 차이가 1이다 */
export type Level = number;

const FLOOR =
  /\((B\d+|\d+F)\)|지하\s*(\d+)\s*층|지상\s*(\d+)\s*층|(B\d+)\s*층?/g;

/** 글에서 층 표기를 나온 순서대로 읽는다 */
export function parseLevels(text: string): Level[] {
  const levels: Level[] = [];
  FLOOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FLOOR.exec(text))) {
    const basement = match[1]?.startsWith('B') ? match[1] : match[4];
    if (basement) levels.push(-Number(basement.slice(1)));
    else if (match[1]) levels.push(Number(match[1].slice(0, -1)) - 1);
    else if (match[2]) levels.push(-Number(match[2]));
    else levels.push(Number(match[3]) - 1);
  }
  return levels;
}

/** 지나는 층마다의 변화를 더한다. 1F -> 2F -> 1F는 차이 0이 아니라 오르내림 2층이다 */
export function travel(levels: readonly Level[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (let i = 1; i < levels.length; i++) {
    const delta = levels[i] - levels[i - 1];
    if (delta > 0) up += delta;
    else down -= delta;
  }
  return { up, down };
}

/**
 * 한 경로(단계별 글)의 층 순서. 출입구에서 시작하는 글인데 첫 단계에 층이 없으면 지상(1F)에서 출발한 것으로 본다.
 * 층이 둘 미만이면 오르내림을 알 수 없어 null
 */
export function pathLevels(
  steps: readonly string[],
  fromExit: boolean,
): Level[] | null {
  if (steps.length === 0) return null;
  let levels = steps.flatMap(parseLevels);
  if (fromExit && /출입구/.test(steps[0]) && parseLevels(steps[0]).length === 0)
    levels = [0, ...levels];
  return levels.length >= 2 ? levels : null;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 환승 경로 글에서 노선을 가리키는 말. 숫자 호선은 `인천1호선`의 `1호선`과 헷갈리지 않게 앞에 `인천`이 없을 때만,
 * `분당선`은 `신분당선`의 일부가 아닐 때만 본다
 */
const LINE_PATTERNS: Record<string, RegExp> = {
  AR: /공항철도/,
  EV: /에버라인|용인경전철/,
  GA: /GTX|지티엑스/i,
  GC: /경춘선/,
  GG: /경강선/,
  GJ: /경의중앙|경의선|중앙선/,
  GM: /김포골드|골드라인/,
  I1: /인천\s*1\s*호선/,
  I2: /인천\s*2\s*호선/,
  SB: /신분당/,
  SD: /수인분당|수인선|(?<!신)분당선/,
  SH: /서해선/,
  SL: /신림선/,
  UI: /우이신설/,
  UJ: /의정부/,
};

/** 글에 이 노선이 나오는지 */
export function mentionsLine(text: string, lineId: string): boolean {
  const pattern = LINE_PATTERNS[lineId];
  if (pattern) return pattern.test(text);
  const number = /^0?(\d)$/.exec(lineId)?.[1];
  if (!number) return false;
  return new RegExp(`(?<!인천\\s*)(?<!\\d)${number}\\s*호선`).test(text);
}

/** 서울교통공사 승강기 운행구간(`B2-1F`, `1F-B1`)의 두 층. 읽지 못하면 null */
export function rangeLevels(range: string): [Level, Level] | null {
  const parts = range.split('-').map((part) => part.trim());
  if (parts.length !== 2) return null;
  const level = (part: string): Level | null => {
    const basement = /^B(\d+)$/.exec(part);
    if (basement) return -Number(basement[1]);
    const ground = /^(\d+)F$/.exec(part);
    return ground ? Number(ground[1]) - 1 : null;
  };
  const a = level(parts[0]);
  const b = level(parts[1]);
  return a === null || b === null || a === b ? null : [a, b];
}

/** 서울교통공사 역명(`청량리(1)`, `충무로(4)`)에서 괄호를 뗀 이름 */
export function baseStationName(name: string): string {
  return name.replace(/\(.*?\)/g, '').trim();
}

/** 서울교통공사 승강기 한 대가 잇는 두 층과 높이(m) */
export interface MeasuredSpan {
  from: Level;
  to: Level;
  meters: number;
}

/**
 * 경로가 지나는 층 구간마다 높이를 더한다(오른 높이와 내린 높이를 따로).
 * 같은 두 층을 잇는 승강기 높이가 있으면 그 중앙값, 없으면 한 층 높이 x 층 수
 */
export function pathMeters(
  levels: readonly Level[],
  spans: readonly MeasuredSpan[],
  levelHeightM: number,
): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    if (a === b) continue;
    const exact = spans
      .filter(
        (s) =>
          Math.min(s.from, s.to) === Math.min(a, b) &&
          Math.max(s.from, s.to) === Math.max(a, b),
      )
      .map((s) => s.meters);
    const meters = median(exact) ?? Math.abs(b - a) * levelHeightM;
    if (b > a) up += meters;
    else down += meters;
  }
  return { up, down };
}
