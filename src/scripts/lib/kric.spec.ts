import { groupRoutes, parseKricRoute } from './kric';

// fixtures use the field names from the KRIC spec; the envelope shapes are assumptions
const row = (order: number, name: string, routCd = 'R1') => ({
  lnCd: 'A1',
  mreaWideCd: '01',
  railOprIsttCd: 'S1',
  routCd,
  routNm: '테스트선',
  stinCd: `S${order}`,
  stinConsOrdr: String(order),
  stinNm: name,
});

describe('parseKricRoute', () => {
  it('finds rows in a data.go.kr style envelope', () => {
    const json = {
      response: {
        header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
        body: { items: { item: [row(2, '나'), row(1, '가')] } },
      },
    };
    expect(parseKricRoute(json).map((r) => r.stinNm)).toEqual(['나', '가']);
  });

  it('finds rows in a flat array and a single-object item', () => {
    expect(parseKricRoute([row(1, '가'), row(2, '나')])).toHaveLength(2);
    expect(
      parseKricRoute({ body: { items: { item: row(1, '가') } } }),
    ).toHaveLength(1);
  });

  it('throws on an error result code', () => {
    const json = {
      header: {
        resultCode: '30',
        resultMsg: 'SERVICE KEY IS NOT REGISTERED ERROR.',
      },
    };
    expect(() => parseKricRoute(json)).toThrow('KRIC error');
  });

  it('converts the order to a number and rejects a missing field', () => {
    expect(parseKricRoute([row(3, '다')])[0].stinConsOrdr).toBe(3);
    const broken = { ...row(1, '가'), stinCd: undefined };
    expect(() => parseKricRoute([broken])).toThrow('stinCd');
  });
});

describe('groupRoutes', () => {
  it('groups by line and route and sorts stations from 상행 to 하행', () => {
    const rows = parseKricRoute([
      row(2, '나'),
      row(1, '가'),
      row(1, '지선1', 'R2'),
    ]);
    const routes = groupRoutes(rows);
    expect(routes).toHaveLength(2);
    const main = routes.find((r) => r.routCd === 'R1');
    expect(main?.stations.map((s) => s.stinNm)).toEqual(['가', '나']);
  });
});
