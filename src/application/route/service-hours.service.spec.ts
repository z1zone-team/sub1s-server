import { ScheduleGroup, TrainScheduleFile } from '../../domain/arrival/models/train-schedule';
import { IHolidayCalendar } from '../../domain/arrival/ports/IHolidayCalendar';
import { PathSegmentDto, SubwayRouteOptionDto } from './dto/route-search-response.dto';
import { ServiceHoursService } from './service-hours.service';

describe('ServiceHoursService', () => {
  // 02_222 안쪽 방향은 05:36(20160)부터 24:30(88200)까지, 휴일 시간표에는 06:00(21600)부터 24:00(86400)까지 있다
  const weekday: ScheduleGroup[] = [['INNER', '성수', 0, [20160, 40000, 88200]]];
  const holiday: ScheduleGroup[] = [['INNER', '성수', 0, [21600, 86400]]];
  const schedule: TrainScheduleFile = {
    dayTypes: {
      weekday: { '02_222': weekday, '03_340': [['UP', '대화', 0, [20000, 80000]]] },
      holiday: { '02_222': holiday },
    },
  };
  const holidays = new Set<string>();
  const calendar: IHolidayCalendar = { isPublicHoliday: async (key) => holidays.has(key) };
  const service = new ServiceHoursService(schedule, calendar);

  const departure = (iso: string) => new Date(`${iso}+09:00`);

  const ride = (lineId: string, stationId: string, boardingAt: string, direction = 'INNER'): PathSegmentDto =>
    ({
      lineId,
      direction,
      fromStationId: stationId,
      fromStationName: '강남',
      boardingAt: `${boardingAt}+09:00`,
    }) as unknown as PathSegmentDto;

  const option = (segments: PathSegmentDto[]) => ({ segments }) as unknown as SubwayRouteOptionDto;

  beforeEach(() => holidays.clear());

  it('leaves the route alone while trains are running', async () => {
    const route = option([ride('02', '02_222', '2026-10-19T09:00:00.000')]);

    await service.annotate([route], departure('2026-10-19T08:50:00'));

    expect(route.segments[0].serviceHours).toBeUndefined();
    expect(route.serviceWarning).toBeUndefined();
  });

  it('warns when the boarding time is after the last train and proposes the next day first train', async () => {
    const route = option([ride('02', '02_222', '2026-10-19T23:50:00.000')]); // 월요일 23:50, 막차는 24:30
    // 24:30 이전이라 아직 탈 수 있다
    await service.annotate([route], departure('2026-10-19T23:40:00'));
    expect(route.serviceWarning).toBeUndefined();

    const late = option([ride('02', '02_222', '2026-10-20T00:45:00.000')]); // 화요일 00:45는 월요일 운행일의 24:45
    await service.annotate([late], departure('2026-10-20T00:35:00'));

    expect(late.segments[0].serviceHours).toEqual({
      status: 'AFTER_LAST_TRAIN',
      firstTrainAt: '2026-10-19T05:36:00.000+09:00',
      lastTrainAt: '2026-10-20T00:30:00.000+09:00',
      nextTrainAt: '2026-10-20T05:36:00.000+09:00',
    });
    expect(late.serviceWarning).toEqual({
      status: 'AFTER_LAST_TRAIN',
      lineId: '02',
      stationId: '02_222',
      stationName: '강남',
      nextTrainAt: '2026-10-20T05:36:00.000+09:00',
      suggestedDepartureAt: '2026-10-20T05:26:00.000+09:00',
    });
  });

  it('warns before the first train and points at the same day first train', async () => {
    const route = option([ride('02', '02_222', '2026-10-19T04:30:00.000')]);

    await service.annotate([route], departure('2026-10-19T04:20:00'));

    expect(route.serviceWarning).toMatchObject({
      status: 'BEFORE_FIRST_TRAIN',
      nextTrainAt: '2026-10-19T05:36:00.000+09:00',
      suggestedDepartureAt: '2026-10-19T05:26:00.000+09:00',
    });
  });

  it('uses the holiday timetable on weekends and public holidays', async () => {
    const sunday = option([ride('02', '02_222', '2026-10-18T05:50:00.000')]);
    await service.annotate([sunday], departure('2026-10-18T05:40:00'));
    expect(sunday.serviceWarning?.status).toBe('BEFORE_FIRST_TRAIN');
    expect(sunday.serviceWarning?.nextTrainAt).toBe('2026-10-18T06:00:00.000+09:00');

    holidays.add('2026-10-19');
    const publicHoliday = option([ride('02', '02_222', '2026-10-19T05:50:00.000')]);
    await service.annotate([publicHoliday], departure('2026-10-19T05:40:00'));
    expect(publicHoliday.serviceWarning?.status).toBe('BEFORE_FIRST_TRAIN');
  });

  it('uses the next day type for the next first train after the last train', async () => {
    // 금요일 막차 뒤. 다음 운행일은 토요일이라 휴일 시간표의 첫차(06:00)
    const route = option([ride('02', '02_222', '2026-10-17T00:45:00.000')]);
    // 토요일 00:45는 금요일 운행일(평일)의 24:45 -> 평일 막차 24:30 뒤, 다음 운행일은 토요일(휴일)
    await service.annotate([route], departure('2026-10-17T00:35:00'));

    expect(route.segments[0].serviceHours?.nextTrainAt).toBe('2026-10-17T06:00:00.000+09:00');
  });

  it('points at the first segment without a train when a later transfer misses the last train', async () => {
    const route = option([
      ride('02', '02_222', '2026-10-19T22:00:00.000'),
      ride('03', '03_340', '2026-10-19T23:30:00.000', 'UP'), // 03_340 UP 막차는 22:13
    ]);

    await service.annotate([route], departure('2026-10-19T21:50:00'));

    expect(route.segments[0].serviceHours).toBeUndefined();
    expect(route.segments[1].serviceHours?.status).toBe('AFTER_LAST_TRAIN');
    expect(route.serviceWarning).toMatchObject({ lineId: '03', stationId: '03_340', status: 'AFTER_LAST_TRAIN' });
  });

  it('does not warn when the station, day type or direction has no timetable', async () => {
    const route = option([
      ride('02', '02_999', '2026-10-19T03:00:00.000'),
      ride('02', '02_222', '2026-10-19T03:00:00.000', 'OUTER'),
    ]);
    await service.annotate([route], departure('2026-10-19T02:50:00'));
    expect(route.serviceWarning).toBeUndefined();

    const noHolidayTable = option([ride('03', '03_340', '2026-10-18T03:00:00.000', 'UP')]);
    await service.annotate([noHolidayTable], departure('2026-10-18T02:50:00'));
    expect(noHolidayTable.serviceWarning).toBeUndefined();
  });

  it('skips walk segments and segments without a boarding time', async () => {
    const route = option([
      { lineId: 'WALK', direction: 'NONE', fromStationId: '02_222' } as unknown as PathSegmentDto,
      { lineId: '02', direction: 'INNER', fromStationId: '02_222' } as unknown as PathSegmentDto,
    ]);

    await service.annotate([route], departure('2026-10-19T03:00:00'));

    expect(route.serviceWarning).toBeUndefined();
  });

  it('does not fail the search when the calendar throws', async () => {
    const broken = new ServiceHoursService(schedule, {
      isPublicHoliday: async () => {
        throw new Error('down');
      },
    });
    const route = option([ride('02', '02_222', '2026-10-19T04:30:00.000')]);

    await expect(broken.annotate([route], departure('2026-10-19T04:20:00'))).resolves.toBeUndefined();
  });
});
