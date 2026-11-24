import { FileStationVerticalRepository } from '../../infra/facility/file-station-vertical.repository';
import { IStationVerticalRepository } from '../../domain/facility/ports/IStationVerticalRepository';
import { verticalTravelOf } from './vertical-travel';

const ride = (lineId: string, fromStationId: string, toStationId: string) => ({
  lineId,
  fromStationId,
  toStationId,
});
const walk = ride('WALK', 'ORIGIN_COORDINATE', '03_330');

describe('verticalTravelOf', () => {
  const fake: IStationVerticalRepository = {
    findStation: (id) =>
      ({
        A: { exitMeters: 10, exitLevels: 2, heightSource: 'DEFAULT' },
        B: { exitMeters: 20, exitLevels: 3, heightSource: 'DEFAULT' },
        C: { exitMeters: 5, exitLevels: 1, heightSource: 'DEFAULT' },
      })[id] as never,
    findTransfer: (from, to) =>
      from === 'B' && to === 'B2'
        ? { meters: 7, levels: 1, matchedLine: true }
        : undefined,
  };

  it('adds boarding, alighting and transfer heights and ignores walks', () => {
    expect(
      verticalTravelOf(
        [walk, ride('03', 'A', 'B'), ride('04', 'B2', 'C')],
        fake,
      ),
    ).toBe(10 + 7 + 5);
  });

  it('does not add anything when riding on from the same node', () => {
    expect(
      verticalTravelOf([ride('09', 'A', 'B'), ride('09', 'B', 'C')], fake),
    ).toBe(15);
  });

  it('is undefined when a station or a transfer has no data', () => {
    expect(verticalTravelOf([ride('01', 'A', 'X')], fake)).toBeUndefined();
    expect(
      verticalTravelOf([ride('03', 'A', 'C'), ride('04', 'C2', 'B')], fake),
    ).toBeUndefined();
    expect(verticalTravelOf([walk], fake)).toBeUndefined();
  });

  describe('with the real station-vertical.json', () => {
    const repository = new FileStationVerticalRepository();

    it('uses the Seoul Metro heights for 충무로 3호선 -> 4호선', () => {
      // 을지로3가(03_330) -> 충무로(03_331) 환승 -> 충무로(04_423) -> 명동(04_424)
      const meters = verticalTravelOf(
        [ride('03', '03_330', '03_331'), ride('04', '04_423', '04_424')],
        repository,
      );
      const expected =
        repository.findStation('03_330')!.exitMeters +
        repository.findTransfer('03_331', '04_423')!.meters +
        repository.findStation('04_424')!.exitMeters;
      expect(meters).toBeCloseTo(expected, 2);
      expect(repository.findStation('03_331')!.heightSource).toBe(
        'SEOUL_METRO',
      );
      expect(repository.findTransfer('03_331', '04_423')!.matchedLine).toBe(
        true,
      );
    });

    it('has no data for 도봉산 1호선, whose exit path is missing in KRIC', () => {
      expect(repository.findStation('01_113')).toBeUndefined();
    });
  });
});
