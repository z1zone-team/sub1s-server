export interface SubwayLineMeta {
  lineName: string;
  colorHex: string;
}

export const SUBWAY_LINES_META: Record<string, SubwayLineMeta> = {
  '01': { lineName: '1호선', colorHex: '#0052A4' },
  '02': { lineName: '2호선', colorHex: '#00A84D' },
  '03': { lineName: '3호선', colorHex: '#EF7C1C' },
  '04': { lineName: '4호선', colorHex: '#00A5DE' },
  '05': { lineName: '5호선', colorHex: '#996CAC' },
  '06': { lineName: '6호선', colorHex: '#CD7C2F' },
  '07': { lineName: '7호선', colorHex: '#747F00' },
  '08': { lineName: '8호선', colorHex: '#E6186C' },
  '09': { lineName: '9호선', colorHex: '#BDB092' },
  SB: { lineName: '신분당선', colorHex: '#D4003B' },
  SU: { lineName: '수인분당선', colorHex: '#F5A200' },
  AR: { lineName: '공항철도', colorHex: '#0090D2' },
  GJ: { lineName: '경의중앙선', colorHex: '#77C4A3' },
  GC: { lineName: '경춘선', colorHex: '#0C8E72' },
  UI: { lineName: '우이신설선', colorHex: '#B7C452' },
  SL: { lineName: '신림선', colorHex: '#6789CA' },
  SH: { lineName: '서해선', colorHex: '#81A914' },
  KK: { lineName: '경강선', colorHex: '#003DA5' },
  GTXA: { lineName: 'GTX-A', colorHex: '#9A6292' },
};

export function getLineMetadata(lineId: string): SubwayLineMeta {
  const meta = SUBWAY_LINES_META[lineId];
  if (meta) return meta;
  return {
    lineName: `${lineId}호선`,
    colorHex: '#888888',
  };
}
