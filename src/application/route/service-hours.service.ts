import { Inject, Injectable, Logger } from '@nestjs/common';
import { kstAddDays, kstDayKey, kstStartOfDay, toKstDate, toKstIso } from '../../common/utils/kst';
import {
  SECONDS_PER_DAY,
  SERVICE_DAY_ROLLOVER_SEC,
  ServiceDayType,
  TrainScheduleFile,
} from '../../domain/arrival/models/train-schedule';
import { HOLIDAY_CALENDAR, IHolidayCalendar } from '../../domain/arrival/ports/IHolidayCalendar';
import { checkBoarding, serviceWindowOf } from '../../domain/operation/models/service-hours';
import { TRAIN_SCHEDULE } from '../../infra/arrival/timetable-next-train.provider';
import { SubwayRouteOptionDto } from './dto/route-search-response.dto';

const WALK_LINE_ID = 'WALK';
const SATURDAY = 6;
const SUNDAY = 0;

interface ServiceDay {
  dayType: ServiceDayType;
  /** 운행일 KST 0시 */
  startEpoch: number;
  /** 그 시각을 운행일 0시 기준 초로 나타낸 값 */
  sec: number;
}

@Injectable()
export class ServiceHoursService {
  private readonly logger = new Logger(ServiceHoursService.name);

  constructor(
    @Inject(TRAIN_SCHEDULE) private readonly schedule: TrainScheduleFile,
    @Inject(HOLIDAY_CALENDAR) private readonly calendar: IHolidayCalendar,
  ) {}

  /**
   * 탑승 구간마다 탑승역에 도착하는 시각(boardingAt)에 탈 열차가 있는지 시간표로 본다. 열차가 없으면 구간에 serviceHours를,
   * 경로에는 가장 앞선 구간의 serviceWarning을 채운다. 시간표가 없는 노선이나 요일은 알 수 없어 그대로 둔다.
   * 어떤 문제가 있어도 경로 검색을 실패시키지 않는다
   */
  async annotate(options: SubwayRouteOptionDto[], departureDate: Date): Promise<void> {
    try {
      for (const option of options) {
        for (const segment of option.segments) {
          if (segment.lineId === WALK_LINE_ID || !segment.boardingAt) continue;
          const boardingEpoch = Date.parse(segment.boardingAt);
          if (Number.isNaN(boardingEpoch)) continue;

          const day = await this.serviceDayOf(boardingEpoch);
          const window = serviceWindowOf(this.schedule.dayTypes[day.dayType]?.[segment.fromStationId], segment.direction);
          if (!window) continue;
          const status = checkBoarding(window, day.sec);
          if (!status) continue;

          const nextTrainEpoch =
            status === 'BEFORE_FIRST_TRAIN'
              ? day.startEpoch + window.firstTrainSec * 1000
              : await this.firstTrainOfNextDay(day, segment.fromStationId, segment.direction);

          segment.serviceHours = {
            status,
            firstTrainAt: toKstIso(day.startEpoch + window.firstTrainSec * 1000),
            lastTrainAt: toKstIso(day.startEpoch + window.lastTrainSec * 1000),
            ...(nextTrainEpoch !== undefined ? { nextTrainAt: toKstIso(nextTrainEpoch) } : {}),
          };

          option.serviceWarning ??= {
            status,
            lineId: segment.lineId,
            stationId: segment.fromStationId,
            stationName: segment.fromStationName,
            ...(nextTrainEpoch !== undefined
              ? {
                  nextTrainAt: toKstIso(nextTrainEpoch),
                  suggestedDepartureAt: toKstIso(departureDate.getTime() + (nextTrainEpoch - boardingEpoch)),
                }
              : {}),
          };
        }
      }
    } catch (error) {
      this.logger.warn(`Service hours skipped: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  private async firstTrainOfNextDay(day: ServiceDay, stationId: string, direction: string): Promise<number | undefined> {
    const startEpoch = kstAddDays(day.startEpoch, 1).getTime();
    const dayType = await this.dayTypeOf(startEpoch);
    const window = serviceWindowOf(this.schedule.dayTypes[dayType]?.[stationId], direction);
    return window ? startEpoch + window.firstTrainSec * 1000 : undefined;
  }

  // 새벽 4시 전은 전날 운행일의 연장이라 24시 이후 시각으로 센다
  private async serviceDayOf(at: number): Promise<ServiceDay> {
    const secondsOfDay = Math.floor((at - kstStartOfDay(at).getTime()) / 1000);
    const afterMidnight = secondsOfDay < SERVICE_DAY_ROLLOVER_SEC;
    const startEpoch = afterMidnight ? kstAddDays(at, -1).getTime() : kstStartOfDay(at).getTime();
    return {
      dayType: await this.dayTypeOf(startEpoch),
      startEpoch,
      sec: afterMidnight ? secondsOfDay + SECONDS_PER_DAY : secondsOfDay,
    };
  }

  // 토요일은 휴일 시각표를 쓴다
  private async dayTypeOf(dayStartEpoch: number): Promise<ServiceDayType> {
    const { year, month, day } = toKstDate(dayStartEpoch);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === SATURDAY || weekday === SUNDAY) return 'holiday';
    return (await this.calendar.isPublicHoliday(kstDayKey(dayStartEpoch))) ? 'holiday' : 'weekday';
  }
}
