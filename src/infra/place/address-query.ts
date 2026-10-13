/**
 * 검색어가 주소인지 가린다. V-World는 장소 이름 검색(`PLACE`)에서 번지를 못 찾고, 주소 검색(`ADDRESS`)은
 * 번지만 주면 전국의 같은 번지를 돌려주므로(`67-1`이 2,453건) 도로명이나 동 이름이 함께 있을 때만 주소로 본다.
 *
 * - `ROAD`: 도로명 주소. `문화로 67-1`, `경기도 광주시 문화로 67-1`, `양천로59길 38`
 * - `PARCEL`: 지번 주소. `가양동 1460`, `경안동 167-42`
 * - `NUMBER_ONLY`: 번지만 있는 입력(`67-1`). 주소로 찾을 수 없다
 * - `PLACE`: 그 밖의 입력(장소 이름)
 *
 * 번지 숫자 뒤에 한글이나 숫자가 이어지면(`을지로3가`, `1번출구`) 번지가 아니므로 주소로 보지 않는다.
 */
export type AddressQueryKind = 'ROAD' | 'PARCEL' | 'NUMBER_ONLY' | 'PLACE';

const LOT_NUMBER = String.raw`\s*\d+(?:-\d+)?(?![가-힣0-9])`;
const ROAD_ADDRESS = new RegExp(String.raw`[가-힣0-9]+(?:대로|로|길)${LOT_NUMBER}`);
const PARCEL_ADDRESS = new RegExp(String.raw`[가-힣0-9]+(?:동|리|가)${LOT_NUMBER}`);
const NUMBER_ONLY = /^[\d\s-]+$/;

export function classifyAddressQuery(query: string): AddressQueryKind {
  const text = query.trim();
  if (NUMBER_ONLY.test(text)) return 'NUMBER_ONLY';
  if (ROAD_ADDRESS.test(text)) return 'ROAD';
  if (PARCEL_ADDRESS.test(text)) return 'PARCEL';
  return 'PLACE';
}
