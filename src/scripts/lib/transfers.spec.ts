import {
  TransferNode,
  TransferRow,
  estimateWalkingSec,
  physicalKey,
  supplementTransfers,
} from './transfers';

const node = (
  id: string,
  lineId: string,
  stationName: string,
  lat: number,
  lng: number,
): TransferNode => ({ id, lineId, stationName, lat, lng });

describe('estimateWalkingSec', () => {
  it('divides the distance by 1.2 m/s', () => {
    expect(estimateWalkingSec(240)).toBe(200);
    expect(estimateWalkingSec(111)).toBe(93);
  });

  it('never goes below 60 seconds, even for identical coordinates', () => {
    expect(estimateWalkingSec(0)).toBe(60);
    expect(estimateWalkingSec(30)).toBe(60);
  });
});

describe('physicalKey', () => {
  it('ignores the 역 suffix, parentheses and dots', () => {
    expect(physicalKey('서울역')).toBe('서울');
    expect(physicalKey('청량리(서울시립대입구)')).toBe('청량리');
    expect(physicalKey('전대.에버랜드')).toBe('전대에버랜드');
  });
});

describe('supplementTransfers', () => {
  const nodes = [
    node('A_1', 'A', '강남', 37, 127),
    node('B_1', 'B', '강남역', 37.001, 127),
    node('C_1', 'C', '강남', 37, 127),
    node('A_2', 'A', '양평', 37, 127),
    node('B_2', 'B', '양평', 37.5, 127.5),
    node('A_3', 'A', '신촌', 37, 127),
    node('B_3', 'B', '신촌', 37.0065, 127),
    node('D_1', 'D', '신도림', 36, 126),
    node('D_2', 'D', '신도림', 36, 126),
  ];
  const known: TransferRow[] = [
    { fromStationId: 'A_1', toStationId: 'B_1', walkingDurationSec: 40 },
    { fromStationId: 'B_1', toStationId: 'A_1', walkingDurationSec: 40 },
  ];

  it('adds mirrored estimated rows for the missing pairs of one physical station', () => {
    const { transfers, added } = supplementTransfers(nodes, known);

    expect(added.map((a) => `${a.fromStationId}>${a.toStationId}`)).toEqual([
      'A_1>C_1',
      'B_1>C_1',
    ]);
    const ac = transfers.find(
      (t) => t.fromStationId === 'A_1' && t.toStationId === 'C_1',
    );
    const ca = transfers.find(
      (t) => t.fromStationId === 'C_1' && t.toStationId === 'A_1',
    );
    expect(ac).toEqual({
      fromStationId: 'A_1',
      toStationId: 'C_1',
      walkingDurationSec: 60,
      isEstimated: true,
    });
    expect(ca?.walkingDurationSec).toBe(60);
    const bc = transfers.find(
      (t) => t.fromStationId === 'B_1' && t.toStationId === 'C_1',
    );
    expect(bc?.walkingDurationSec).toBe(93);
  });

  it('keeps known rows unchanged and marks them as not estimated', () => {
    const { transfers } = supplementTransfers(nodes, known);

    expect(
      transfers.find(
        (t) => t.fromStationId === 'A_1' && t.toStationId === 'B_1',
      ),
    ).toEqual({
      fromStationId: 'A_1',
      toStationId: 'B_1',
      walkingDurationSec: 40,
      isEstimated: false,
    });
  });

  it('does not connect same-name stations that are far apart', () => {
    const { transfers } = supplementTransfers(nodes, known);

    expect(transfers.some((t) => t.fromStationId === 'A_2')).toBe(false);
    expect(transfers.some((t) => t.fromStationId === 'B_2')).toBe(false);
  });

  it('does not connect separate stations of the same name 700m apart', () => {
    const { transfers } = supplementTransfers(nodes, known);

    expect(transfers.some((t) => t.fromStationId === 'A_3')).toBe(false);
    expect(transfers.some((t) => t.fromStationId === 'B_3')).toBe(false);
  });

  it('does not connect nodes of the same line', () => {
    const { transfers } = supplementTransfers(nodes, known);

    expect(transfers.some((t) => t.fromStationId === 'D_1')).toBe(false);
  });

  it('is idempotent when run on its own output', () => {
    const first = supplementTransfers(nodes, known);
    const second = supplementTransfers(nodes, first.transfers);

    expect(second.added).toEqual([]);
    expect(second.transfers).toEqual(first.transfers);
  });

  it('populates recommendedDoors from stairsMap when provided', () => {
    const stairsMap = {
      A_1: { doors: ['2-1', '4-4'] },
      B_1: { doors: ['1-1'] },
      C_1: { doors: ['3-2'] },
    };
    const { transfers } = supplementTransfers(nodes, known, stairsMap);
    const ab = transfers.find(
      (t) => t.fromStationId === 'A_1' && t.toStationId === 'B_1',
    );
    const ac = transfers.find(
      (t) => t.fromStationId === 'A_1' && t.toStationId === 'C_1',
    );
    expect(ab?.recommendedDoors).toEqual(['2-1', '4-4']);
    expect(ac?.recommendedDoors).toEqual(['2-1', '4-4']);
  });

  it('applies calibrated walking duration and marks as not estimated when overrides are provided', () => {
    const overrides = {
      'A_1>C_1': 180,
    };
    const { transfers } = supplementTransfers(nodes, known, {}, overrides);
    const ac = transfers.find(
      (t) => t.fromStationId === 'A_1' && t.toStationId === 'C_1',
    );
    const ca = transfers.find(
      (t) => t.fromStationId === 'C_1' && t.toStationId === 'A_1',
    );
    expect(ac?.walkingDurationSec).toBe(180);
    expect(ac?.isEstimated).toBe(false);
    expect(ca?.walkingDurationSec).toBe(180);
    expect(ca?.isEstimated).toBe(false);
  });
});
