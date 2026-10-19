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
