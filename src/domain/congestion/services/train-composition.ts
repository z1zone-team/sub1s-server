/**
 * 열차 한 편성의 칸 수. 근거는 두 가지다(서버 이슈 #156).
 * 1) 서울 1~9호선, 우이신설, 신림: 서울시 공식 자료(서울지하철 현황 및 이용안내, 2025-01-31 기준)를 KRIC 계단과
 *    엘리베이터 칸 번호 데이터의 호선별 최댓값과 교차 확인했다
 * 2) 공항철도, 신분당선, 김포골드라인: 공식 표는 찾지 못했다. KRIC 칸 번호 데이터에서 1부터 최댓값까지 빠짐없이
 *    충분한 표본(공항철도 8개 역 43건, 신분당선 7개 역 50건)으로 나오고 독립된 출처가 하나 더 있는 것만 넣었다
 *    (공항철도와 신분당선은 2014년 서울시 글이 6량, 김포골드라인은 1편성 2량과 승강장이 2량 기준이라는 2024~2026년 보도)
 * KRIC `subwayComposed`는 편성 칸수를 주지 않아(`IC` 외 데이터 없음) 쓸 수 없다.
 *
 * 값이 없는 노선은 칸 수를 모르는 것이다. 이 경우 칸별 혼잡도와 추천 칸을 만들지 않는다
 * (없는 칸을 한산한 칸으로 추천하는 것보다 추천하지 않는 편이 안전하다)
 */
const LINE_CAR_COUNT: Readonly<Record<string, number>> = {
  '01': 10,
  '02': 10, // 순환선. 지선은 아래에서 따로 본다
  '03': 10,
  '04': 10,
  '05': 8,
  '06': 8,
  '07': 8,
  '08': 6,
  '09': 6,
  UI: 2, // 우이신설선
  SL: 3, // 신림선
  AR: 6, // 공항철도
  SB: 6, // 신분당선
  GM: 2, // 김포골드라인
  // 인천교통공사 공식 사이트(ictr.or.kr) 전동차 현황, 2026-10-15 확인(페이지에 기준 날짜 없음)
  I1: 8, // 인천 1호선: 1편성 8량(4M4T), 34편성 272량
  I2: 2, // 인천 2호선: 1편성 2량(MC1-MC2), 43편성 86량
};

/** 2호선 성수지선(신설동~성수)은 4량. 성수는 순환선 역이라 지선 역에서 뺀다 */
const LINE2_SEONGSU_BRANCH_STATIONS: ReadonlySet<string> = new Set([
  '02_211-1', // 용답
  '02_211-2', // 신답
  '02_211-3', // 용두
  '02_211-4', // 신설동
]);
const LINE2_SEONGSU_BRANCH_CAR_COUNT = 4;

/** 2호선 신정지선(신도림~까치산)은 6량. 신도림은 순환선 역이라 지선 역에서 뺀다 */
const LINE2_SINJEONG_BRANCH_STATIONS: ReadonlySet<string> = new Set([
  '02_234-1', // 도림천
  '02_234-2', // 양천구청
  '02_234-3', // 신정네거리
  '02_234-4', // 까치산
]);
const LINE2_SINJEONG_BRANCH_CAR_COUNT = 6;

/**
 * 이 호선의 열차가 몇 칸인지. 모르는 노선은 undefined다.
 * 구간의 두 역(출발역과 도착역)을 모두 넘기면 2호선 지선을 지나는 구간을 가려낸다
 * (지선 열차는 순환선 열차와 칸 수가 다르다). 순환선 역만 넘기면 10이다
 */
export function trainCarCount(
  lineId: string,
  stationIds: readonly string[] = [],
): number | undefined {
  if (lineId === '02') {
    if (stationIds.some((id) => LINE2_SEONGSU_BRANCH_STATIONS.has(id))) {
      return LINE2_SEONGSU_BRANCH_CAR_COUNT;
    }
    if (stationIds.some((id) => LINE2_SINJEONG_BRANCH_STATIONS.has(id))) {
      return LINE2_SINJEONG_BRANCH_CAR_COUNT;
    }
  }
  return LINE_CAR_COUNT[lineId];
}
