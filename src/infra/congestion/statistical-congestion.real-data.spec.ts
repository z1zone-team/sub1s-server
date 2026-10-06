import { join } from 'path';
import { FareRule } from '../../domain/subway/fare/fare-calculator';
import {
  GraphData,
  SubwayGraph,
} from '../../domain/subway/models/subway-graph';
import { OUT_DIR, readJson } from '../../scripts/lib/subway-common';
import { DijkstraRouteEngine } from '../routing/dijkstra-route.engine';
import {
  CongestionData,
  StatisticalCongestionProvider,
} from './statistical-congestion.provider';

interface PublishedCongestion extends CongestionData {
  slotCount: number;
}

const kst = (iso: string): number => new Date(`${iso}+09:00`).getTime();

// Regression checks on the real refined data (서울교통공사 지하철혼잡도정보, 2026-06-30 기준).
// Expected values are copied from the published file; update them when the data is refreshed.
describe('StatisticalCongestionProvider on the published congestion data', () => {
  const congestion = readJson<PublishedCongestion>(
    join(OUT_DIR, 'congestion.json'),
  );
  const provider = new StatisticalCongestionProvider(congestion);
  const stationIds = new Set(
    readJson<{ id: string }[]>(join(OUT_DIR, 'stations.json')).map((s) => s.id),
  );

  it('keeps the published values unchanged', () => {
    const seoul = congestion.records.find(
      (r) =>
        r.stationId === '01_133' &&
        r.direction === 'DOWN' &&
        r.dayType === 'WEEKDAY',
    );

    // 서울역 1호선 하선, 평일 18:00~18:30 (the data holds more than 100)
    expect(seoul?.rates[25]).toBe(123.91225525743292);
  });

  it('has 39 slots for every record and only known stations and directions', () => {
    expect(congestion.slotCount).toBe(39);
    for (const record of congestion.records) {
      expect(record.rates).toHaveLength(39);
      expect(stationIds.has(record.stationId)).toBe(true);
      expect(['UP', 'DOWN', 'INNER', 'OUTER']).toContain(record.direction);
    }
  });

  it('reads 서울역 1호선 상선 on a weekday morning from the statistics', () => {
    expect(
      provider.stationRate('01', '01_133', 'UP', kst('2026-10-05T08:45:00')),
    ).toEqual({ ratePercent: 92.20630891950688, source: 'STATISTICS' });
  });

  it('caps a published rate above 100 percent', () => {
    expect(
      provider.stationRate('01', '01_133', 'DOWN', kst('2026-10-05T18:15:00'))
        .ratePercent,
    ).toBe(100);
  });

  it('is busier toward the center in the morning and away from it in the evening', () => {
    const morning = kst('2026-10-05T08:15:00');
    const evening = kst('2026-10-05T18:15:00');

    // 서울역 1호선: 상선 (toward 의정부) is crowded in the morning, 하선 (toward 수원) in the evening
    expect(
      provider.stationRate('01', '01_133', 'UP', morning).ratePercent,
    ).toBeGreaterThan(
      provider.stationRate('01', '01_133', 'DOWN', morning).ratePercent,
    );
    expect(
      provider.stationRate('01', '01_133', 'DOWN', evening).ratePercent,
    ).toBeGreaterThan(
      provider.stationRate('01', '01_133', 'UP', evening).ratePercent,
    );
  });

  it('uses the model for lines without statistics, such as GTX-A', () => {
    expect(
      provider.stationRate('GA', 'GA_X106', 'DOWN', kst('2026-10-05T08:15:00'))
        .source,
    ).toBe('MOCK');
  });

  describe('with the route engine', () => {
    const graph = new SubwayGraph({
      stations: readJson(join(OUT_DIR, 'stations.json')),
      edges: readJson(join(OUT_DIR, 'edges.json')),
      transfers: readJson(join(OUT_DIR, 'transfers.json')),
    } as GraphData);
    const engine = new DijkstraRouteEngine(
      { getGraph: () => graph },
      provider,
      readJson<FareRule>(join(OUT_DIR, 'fare-rules.json')),
    );
    const trip = (mode: 'OPTIMAL' | 'COMFORTABLE', iso: string) =>
      engine.findRoute({
        originStationId: '03_330', // 을지로3가 (line 3)
        destinationStationId: '02_222', // 강남
        mode,
        departureAt: new Date(`${iso}+09:00`),
      });

    it('detours around the morning rush but not in the afternoon', async () => {
      const optimal = await trip('OPTIMAL', '2026-10-05T08:00:00');
      const rush = await trip('COMFORTABLE', '2026-10-05T08:00:00');
      const afternoon = await trip('COMFORTABLE', '2026-10-05T14:00:00');

      expect(rush.stationIds).not.toEqual(optimal.stationIds);
      expect(rush.stationIds).not.toEqual(afternoon.stationIds);
      // the reported duration is the real riding time, not the weighted cost
      expect(rush.totalDurationSec).toBeLessThan(
        optimal.totalDurationSec * 1.3,
      );
    });

    it('gives the same route for the same departure time', async () => {
      const a = await trip('COMFORTABLE', '2026-10-05T08:00:00');
      const b = await trip('COMFORTABLE', '2026-10-05T08:00:00');

      expect(a).toEqual(b);
    });
  });
});
