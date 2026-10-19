import { TransferNode, TransferRow } from './transfers';

export const MOLIT_FAST_TRANSFER_URL =
  'https://api.odcloud.kr/api/15151816/v1/uddi:e9c2bb71-05e8-4767-8397-9df787ee70f6';

/** 한 번에 전부 받기 위한 페이지 크기. 기준일 2025-09-23 자료가 1,052행이다 */
export const MOLIT_FAST_TRANSFER_PER_PAGE = 2000;

export interface MolitFastTransferRow {
  철도운영기관명: string;
  노선명: string;
  역명: string;
  종착역명: string;
  환승철도운영기관명: string;
  환승선: string;
  환승이후역명: string;
  환승기점역명: string;
  차량순서: number;
  차량출입문번호: number;
}

export interface MolitFastTransferResponse {
  page: number;
  perPage: number;
  totalCount: number;
  currentCount: number;
  data: MolitFastTransferRow[];
}

/** 공공데이터포털 키는 인코딩된 값(% 포함)과 디코딩된 값이 있다. 이미 인코딩돼 있으면 그대로 쓴다 */
export function buildFastTransferUrl(key: string): string {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  return `${MOLIT_FAST_TRANSFER_URL}?page=1&perPage=${MOLIT_FAST_TRANSFER_PER_PAGE}&serviceKey=${serviceKey}`;
}

/** 응답이 한 번에 전부 담겼는지 확인한다. 덜 받았으면 호출을 늘리지 않고 알려 준다 */
export function parseFastTransferResponse(body: unknown): MolitFastTransferResponse {
  const response = body as Partial<MolitFastTransferResponse> & { code?: number; msg?: string };
  if (response?.code !== undefined) {
    throw new Error(`API error ${response.code}: ${response.msg ?? ''}`);
  }
  if (!Array.isArray(response?.data) || typeof response.totalCount !== 'number') {
    throw new Error('unexpected response shape');
  }
  if (response.data.length < response.totalCount) {
    throw new Error(
      `incomplete response: ${response.data.length} of ${response.totalCount} rows, raise MOLIT_FAST_TRANSFER_PER_PAGE`,
    );
  }
  return response as MolitFastTransferResponse;
}

/** 표기 차이를 맞춘다. 괄호 부기("청량리(서울시립대입구)")와 공백을 뗀다 */
function stationKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\(.*?\)/g, '').replace(/\s/g, '');
}

/** 노선명은 끝의 "선"도 뗀다("수인분당선"과 "수인분당"을 같게). 역명에는 쓰지 않는다("선릉") */
function lineKey(value: string | null | undefined): string {
  return stationKey(value).replace(/선$/, '');
}

function doorOrder(a: string, b: string): number {
  const [aCar, aDoor] = a.split('-').map(Number);
  const [bCar, bDoor] = b.split('-').map(Number);
  return aCar - bCar || aDoor - bDoor;
}

/** "환승하는 역의 노선, 역, 갈아탈 노선"마다 진행 방향이 다른 문을 모두 모은 칸-문 목록 */
export function buildFastTransferDoors(rows: MolitFastTransferRow[]): Map<string, string[]> {
  const doors = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.노선명 || !row.역명 || !row.환승선) continue;
    if (!Number.isInteger(row.차량순서) || !Number.isInteger(row.차량출입문번호)) continue;
    const key = `${lineKey(row.노선명)}|${stationKey(row.역명)}|${lineKey(row.환승선)}`;
    const set = doors.get(key) ?? new Set<string>();
    set.add(`${row.차량순서}-${row.차량출입문번호}`);
    doors.set(key, set);
  }
  return new Map([...doors].map(([key, set]) => [key, [...set].sort(doorOrder)]));
}

export interface FastTransferStats {
  /** 새 자료의 문으로 바꾼 환승 행 */
  fromMolit: number;
  /** 새 자료가 없어 기존 값을 그대로 둔 환승 행 */
  kept: number;
  /** 두 쪽 모두 없어 비어 있는 환승 행 */
  empty: number;
}

/** 새 자료가 있는 환승은 그 문으로 바꾸고, 없으면 기존 recommendedDoors를 그대로 둔다. 여러 번 돌려도 결과가 같다 */
export function applyFastTransferDoors(
  transfers: TransferRow[],
  stations: TransferNode[],
  lineNames: Record<string, string>,
  rows: MolitFastTransferRow[],
): { transfers: TransferRow[]; stats: FastTransferStats } {
  const doors = buildFastTransferDoors(rows);
  const byId = new Map(stations.map((station) => [station.id, station]));
  const stats: FastTransferStats = { fromMolit: 0, kept: 0, empty: 0 };

  const result = transfers.map((transfer) => {
    const from = byId.get(transfer.fromStationId);
    const to = byId.get(transfer.toStationId);
    const fromLine = from && lineNames[from.lineId];
    const toLine = to && lineNames[to.lineId];
    const found =
      from && fromLine && toLine
        ? doors.get(`${lineKey(fromLine)}|${stationKey(from.stationName)}|${lineKey(toLine)}`)
        : undefined;
    if (found) {
      stats.fromMolit += 1;
      return { ...transfer, recommendedDoors: [...found] };
    }
    if (transfer.recommendedDoors && transfer.recommendedDoors.length > 0) stats.kept += 1;
    else stats.empty += 1;
    return transfer;
  });
  return { transfers: result, stats };
}
