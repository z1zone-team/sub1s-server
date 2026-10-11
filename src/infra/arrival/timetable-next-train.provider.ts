import { Inject, Injectable } from '@nestjs/common';
import {
  SECONDS_PER_DAY,
  SERVICE_DAY_ROLLOVER_SEC,
  ScheduleGroup,
  ServiceDayType,
  TrainScheduleFile,
} from '../../domain/arrival/models/train-schedule';
import {
  HOLIDAY_CALENDAR,
  IHolidayCalendar,
} from '../../domain/arrival/ports/IHolidayCalendar';
import {
  INextTrainProvider,
  NextTrain,
  NextTrainQuery,
  NextTrainSnapshot,
} from '../../domain/arrival/ports/INextTrainProvider';
import {
  kstAddDays,
  kstDayKey,
  kstStartOfDay,
  toKstDate,
} from '../../common/utils/kst';

export const TRAIN_SCHEDULE = Symbol('TRAIN_SCHEDULE');

const TRAINS_PER_GROUP = 3;
const LOOKAHEAD_SEC = 2 * 60 * 60;
const SATURDAY = 6;
const SUNDAY = 0;

interface ServiceDay {
  dayType: ServiceDayType;
  /** 지금 시각을 이 운행일 0시 기준 초로 나타낸 값 */
  nowSec: number;
}

@Injectable()
export class TimetableNextTrainProvider implements INextTrainProvider {
  constructor(
    @Inject(TRAIN_SCHEDULE) private readonly schedule: TrainScheduleFile,
    @Inject(HOLIDAY_CALENDAR) private readonly calendar: IHolidayCalendar,
  ) {}

  async fetchNextTrains(query: NextTrainQuery): Promise<NextTrainSnapshot> {
    const now = Date.now();
    const days = await this.serviceDays(now);

    const trains: NextTrain[] = [];
    let hasData = false;
    for (const day of days) {
      const groups = this.schedule.dayTypes[day.dayType]?.[query.stationId];
      if (!groups) continue;
      hasData = true;
      for (const group of groups) {
        trains.push(...this.upcoming(group, day.nowSec));
      }
    }

    return {
      source: 'TIMETABLE',
      status: hasData ? 'OK' : this.missingStatus(query.stationId),
      observedAt: new Date(now),
      trains,
    };
  }

  // 새벽 4시 전에는 전날 운행일의 24시 이후 열차가 아직 운행 중이다
  private async serviceDays(now: number): Promise<ServiceDay[]> {
    const secondsOfDay = Math.floor((now - kstStartOfDay(now).getTime()) / 1000);
    const days: ServiceDay[] = [
      { dayType: await this.dayTypeOf(now), nowSec: secondsOfDay },
    ];
    if (secondsOfDay < SERVICE_DAY_ROLLOVER_SEC) {
      days.push({
        dayType: await this.dayTypeOf(kstAddDays(now, -1).getTime()),
        nowSec: secondsOfDay + SECONDS_PER_DAY,
      });
    }
    return days;
  }

  // 토요일은 휴일 시각표를 쓴다
  private async dayTypeOf(at: number): Promise<ServiceDayType> {
    const { year, month, day } = toKstDate(at);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === SATURDAY || weekday === SUNDAY) return 'holiday';
    return (await this.calendar.isPublicHoliday(kstDayKey(at))) ? 'holiday' : 'weekday';
  }

  private upcoming(group: ScheduleGroup, nowSec: number): NextTrain[] {
    const [direction, headsign, express, times] = group;
    let low = 0;
    let high = times.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (times[mid] < nowSec) low = mid + 1;
      else high = mid;
    }

    const result: NextTrain[] = [];
    for (let i = low; i < times.length && result.length < TRAINS_PER_GROUP; i += 1) {
      const arrivalInSec = times[i] - nowSec;
      if (arrivalInSec > LOOKAHEAD_SEC) break;
      result.push({
        direction,
        headsign,
        arrivalInSec,
        message: `${formatClock(times[i])} 출발 예정`,
        isExpress: express === 1,
      });
    }
    return result;
  }

  // 어느 운행일에도 이 역이 없으면 지원하지 않는 노선이고, 다른 날 종류에만 있으면 그날 시각표가 없는 것이다
  private missingStatus(stationId: string): 'UNSUPPORTED_LINE' | 'UNAVAILABLE' {
    const known = (Object.keys(this.schedule.dayTypes) as ServiceDayType[]).some(
      (dayType) => this.schedule.dayTypes[dayType]?.[stationId],
    );
    return known ? 'UNAVAILABLE' : 'UNSUPPORTED_LINE';
  }
}

function formatClock(serviceSec: number): string {
  const secondsOfDay = serviceSec % SECONDS_PER_DAY;
  const hours = Math.floor(secondsOfDay / 3600);
  const minutes = Math.floor((secondsOfDay % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
