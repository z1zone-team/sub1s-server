import { join } from 'path';
import { OUT_DIR, loadStations, readJson } from './subway-common';
import { TransferRow, supplementTransfers } from './transfers';

interface EdgeRow {
  fromStationId: string;
  toStationId: string;
}

describe('refined transfers.json', () => {
  const stations = loadStations();
  const transfers = readJson<TransferRow[]>(join(OUT_DIR, 'transfers.json'));
  const edges = readJson<EdgeRow[]>(join(OUT_DIR, 'edges.json'));

  it('has no missing transfer between lines at one physical station', () => {
    // supplement:transfers must have been run after refine:transfers
    expect(supplementTransfers(stations, transfers).added).toEqual([]);
  });

  it('mirrors every transfer', () => {
    const keys = new Set(
      transfers.map((t) => `${t.fromStationId}>${t.toStationId}`),
    );
    for (const t of transfers) {
      expect(keys.has(`${t.toStationId}>${t.fromStationId}`)).toBe(true);
    }
  });

  it('connects every GTX-A station to the rest of the network through a transfer', () => {
    const ids = new Set(
      stations.filter((s) => s.lineId === 'GA').map((s) => s.id),
    );
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let root = parent.get(x) ?? x;
      while ((parent.get(root) ?? root) !== root)
        root = parent.get(root) ?? root;
      parent.set(x, root);
      return root;
    };
    const union = (a: string, b: string): void => {
      parent.set(find(a), find(b));
    };
    edges.forEach((e) => union(e.fromStationId, e.toStationId));
    transfers.forEach((t) => union(t.fromStationId, t.toStationId));

    const mainRoot = find('02_222');
    // GTX-A reaches the main network at 서울, 연신내, 대곡, 수서, 성남 and 구성
    const connected = [...ids].filter((id) => find(id) === mainRoot);
    expect(connected.length).toBeGreaterThanOrEqual(6);
  });

  it('calibrates supplemented rows with measured overrides and keeps Seoul Metro rows measured', () => {
    expect(
      transfers.every((t) => typeof t.walkingDurationSec === 'number'),
    ).toBe(true);
    const dongjak = transfers.find(
      (t) => t.fromStationId === '04_431' && t.toStationId === '09_920',
    );
    expect(dongjak).toMatchObject({
      walkingDurationSec: 204,
      isEstimated: false,
    });
    const seoulGtx = transfers.find(
      (t) => t.fromStationId === '01_133' && t.toStationId === 'GA_X106',
    );
    expect(seoulGtx).toMatchObject({
      walkingDurationSec: 360,
      isEstimated: false,
    });
  });

  it('populates recommendedDoors on transfer edges, preferring the MOLIT fast transfer data', () => {
    const withDoors = transfers.filter(
      (t) => t.recommendedDoors && t.recommendedDoors.length > 0,
    );
    expect(withDoors.length).toBeGreaterThanOrEqual(200);

    const cityHall = transfers.find(
      (t) => t.fromStationId === '02_201' && t.toStationId === '01_132',
    );
    expect(cityHall?.recommendedDoors).toEqual(['1-1', '10-4']);
  });
});
