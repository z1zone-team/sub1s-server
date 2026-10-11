import { TrainScheduleFile } from '../../domain/arrival/models/train-schedule';
import { IHolidayCalendar } from '../../domain/arrival/ports/IHolidayCalendar';
import { TimetableNextTrainProvider } from './timetable-next-train.provider';

describe('TimetableNextTrainProvider', () => {
  const hms = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

  const schedule: TrainScheduleFile = {
    dayTypes: {
      weekday: {
        '09_925': [
          ['DOWN', '중앙보훈병원', 0, [hms(8, 0), hms(8, 5), hms(8, 10), hms(8, 15), hms(24, 20)]],
          ['DOWN', '중앙보훈병원', 1, [hms(8, 2)]],
          ['UP', '개화', 0, [hms(8, 3)]],
        ],
        '02_222': [['OUTER', '성수', 0, [hms(9, 0)]]],
      },
      holiday: {
        '09_925': [['DOWN', '중앙보훈병원', 0, [hms(9, 0), hms(9, 10)]]],
      },
    },
  };

  const holidays = new Set<string>();
  const calendar: IHolidayCalendar = {
    isPublicHoliday: jest.fn(async (dayKey: string) => holidays.has(dayKey)),
  };
  const provider = () => new TimetableNextTrainProvider(schedule, calendar);
  const query = { stationId: '09_925', lineId: '09', stationName: '신논현' };

  // 2026-10-12는 월요일이다. KST 시각을 UTC로 바꿔 고정한다
  const atKst = (iso: string) =>
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(`${iso}+09:00`));

  beforeEach(() => {
    holidays.clear();
    (calendar.isPublicHoliday as jest.Mock).mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists the upcoming departures with the seconds left and a scheduled-time message', async () => {
    atKst('2026-10-12T07:58:30');

    const snapshot = await provider().fetchNextTrains(query);

    expect(snapshot.source).toBe('TIMETABLE');
    expect(snapshot.status).toBe('OK');
    expect(snapshot.trains[0]).toEqual({
      direction: 'DOWN',
      headsign: '중앙보훈병원',
      arrivalInSec: 90,
      message: '08:00 출발 예정',
      isExpress: false,
    });
  });

  it('returns at most three upcoming trains for each destination group', async () => {
    atKst('2026-10-12T07:58:30');

    const snapshot = await provider().fetchNextTrains(query);

    const regular = snapshot.trains.filter((t) => t.direction === 'DOWN' && !t.isExpress);
    expect(regular.map((t) => t.message)).toEqual(['08:00 출발 예정', '08:05 출발 예정', '08:10 출발 예정']);
  });

  it('keeps express and regular trains and both directions', async () => {
    atKst('2026-10-12T07:58:30');

    const snapshot = await provider().fetchNextTrains(query);

    expect(snapshot.trains.some((t) => t.isExpress && t.arrivalInSec === 210)).toBe(true);
    expect(snapshot.trains.some((t) => t.direction === 'UP' && t.headsign === '개화')).toBe(true);
  });

  it('skips trains that already left and the ones further than two hours away', async () => {
    atKst('2026-10-12T08:05:01');

    const snapshot = await provider().fetchNextTrains(query);

    const times = snapshot.trains.map((t) => t.message);
    expect(times).not.toContain('08:00 출발 예정');
    expect(times).not.toContain('08:05 출발 예정');
    expect(times).toContain('08:10 출발 예정');
  });

  it('has no trains but is still OK when the last train has gone', async () => {
    atKst('2026-10-12T12:00:00');

    const snapshot = await provider().fetchNextTrains(query);

    expect(snapshot.status).toBe('OK');
    expect(snapshot.trains).toEqual([]);
  });

  it('uses the holiday timetable on Saturday and Sunday', async () => {
    atKst('2026-10-17T08:50:00');
    expect((await provider().fetchNextTrains(query)).trains[0].message).toBe('09:00 출발 예정');

    atKst('2026-10-18T08:50:00');
    expect((await provider().fetchNextTrains(query)).trains[0].message).toBe('09:00 출발 예정');
    expect(calendar.isPublicHoliday).not.toHaveBeenCalled();
  });

  it('uses the holiday timetable on a public holiday that falls on a weekday', async () => {
    holidays.add('2026-10-09');
    atKst('2026-10-09T08:50:00');

    const snapshot = await provider().fetchNextTrains(query);

    expect(calendar.isPublicHoliday).toHaveBeenCalledWith('2026-10-09');
    expect(snapshot.trains[0].message).toBe('09:00 출발 예정');
  });

  describe('after midnight', () => {
    it('shows the late trains of the previous service day', async () => {
      atKst('2026-10-13T00:10:00');

      const snapshot = await provider().fetchNextTrains(query);

      expect(snapshot.trains).toEqual([
        {
          direction: 'DOWN',
          headsign: '중앙보훈병원',
          arrivalInSec: 600,
          message: '00:20 출발 예정',
          isExpress: false,
        },
      ]);
    });

    it('picks the timetable type of the previous day for those trains', async () => {
      // 토요일 새벽 0시 10분: 전날은 금요일(평일)이라 평일 시각표의 24:20 열차가 나온다
      atKst('2026-10-17T00:10:00');

      const snapshot = await provider().fetchNextTrains(query);

      expect(snapshot.trains.map((t) => t.message)).toContain('00:20 출발 예정');
    });

    it('stops looking at the previous day after four in the morning', async () => {
      atKst('2026-10-13T04:30:00');

      expect((await provider().fetchNextTrains(query)).trains).toEqual([]);
    });
  });

  it('uses the KST date even when the server clock is in another zone', async () => {
    // 2026-10-12 23:30 UTC는 KST로 10월 13일 08:30이다
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T23:30:00Z'));

    const snapshot = await provider().fetchNextTrains(query);

    expect(calendar.isPublicHoliday).toHaveBeenCalledWith('2026-10-13');
    expect(snapshot.status).toBe('OK');
  });

  describe('status', () => {
    it('is UNAVAILABLE when only the other day type has this station', async () => {
      atKst('2026-10-17T08:50:00');

      const snapshot = await provider().fetchNextTrains({ stationId: '02_222', lineId: '02', stationName: '강남' });

      expect(snapshot.status).toBe('UNAVAILABLE');
      expect(snapshot.trains).toEqual([]);
    });

    it('is UNSUPPORTED_LINE when no day type has the station', async () => {
      atKst('2026-10-12T08:00:00');

      const snapshot = await provider().fetchNextTrains({ stationId: 'ZZ_1', lineId: 'ZZ', stationName: '없음' });

      expect(snapshot.status).toBe('UNSUPPORTED_LINE');
    });

    it('is UNAVAILABLE for a holiday while the holiday timetable is not collected yet', async () => {
      atKst('2026-10-17T08:50:00');
      const empty: TrainScheduleFile = { dayTypes: { weekday: schedule.dayTypes.weekday, holiday: {} } };

      const snapshot = await new TimetableNextTrainProvider(empty, calendar).fetchNextTrains(query);

      expect(snapshot.status).toBe('UNAVAILABLE');
    });
  });
});
