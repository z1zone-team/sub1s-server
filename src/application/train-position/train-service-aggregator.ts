import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OBSERVATION_RETENTION_DAYS,
  aggregateServiceDay,
  previousServiceDate,
  serviceDayWindow,
} from '../../domain/train-position/models/train-observation';
import {
  ITrainObservationRepository,
  TRAIN_OBSERVATION_REPOSITORY,
} from '../../domain/train-position/ports/ITrainObservationRepository';
import {
  ITrainPositionProvider,
  TRAIN_POSITION_PROVIDER,
} from '../../domain/train-position/ports/ITrainPositionProvider';
import { kstStartOfDay } from '../../common/utils/kst';

const TICK_MS = 10 * 60 * 1000;
/** 운행일이 바뀐 뒤(04:00) 이만큼 지나면 전날을 집계한다 */
const AGGREGATE_AFTER_SEC = 4 * 60 * 60 + 30 * 60;

/**
 * 매일 04:30(KST) 이후 전날 운행일의 관측을 역과 방향별 첫, 마지막 관측 시각으로 집계하고, 보관 기간이 지난 관측을 지운다.
 * 실제 서울시 위치를 모으는 서버에서만 켜진다. 같은 운행일을 다시 집계해도 결과를 덮어쓸 뿐이라 재시작해도 안전하다
 */
@Injectable()
export class TrainServiceAggregator implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrainServiceAggregator.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastAggregated = '';

  constructor(
    @Inject(TRAIN_POSITION_PROVIDER) private readonly provider: ITrainPositionProvider,
    private readonly config: ConfigService,
    @Optional()
    @Inject(TRAIN_OBSERVATION_REPOSITORY)
    private readonly observations?: ITrainObservationRepository,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (!this.observations || this.running) return;
    const secondsOfDay = (now.getTime() - kstStartOfDay(now).getTime()) / 1000;
    if (secondsOfDay < AGGREGATE_AFTER_SEC) return;

    const serviceDate = previousServiceDate(now);
    if (serviceDate === this.lastAggregated) return;

    this.running = true;
    try {
      const window = serviceDayWindow(serviceDate);
      const observed = await this.observations.findBetween(new Date(window.from), new Date(window.to));
      const rows = aggregateServiceDay(serviceDate, observed);
      await this.observations.upsertDaily(rows);

      const cutoff = new Date(now.getTime() - OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const deleted = await this.observations.deleteObservationsBefore(cutoff);
      this.lastAggregated = serviceDate;
      this.logger.log(
        `Train service hours aggregated for ${serviceDate}: ${observed.length} observations -> ${rows.length} rows, ${deleted} old observations deleted`,
      );
    } catch (error) {
      this.logger.error(
        `Train service aggregation failed for ${serviceDate}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  // 가짜 열차를 보여 주는 서버와 열차 위치 폴링을 끈 서버, 테스트 환경에서는 켜지 않는다
  private enabled(): boolean {
    return (
      process.env.NODE_ENV !== 'test' &&
      this.provider.source === 'REALTIME' &&
      String(this.config.get('TRAIN_POSITION_ENABLED')) === 'true'
    );
  }
}
