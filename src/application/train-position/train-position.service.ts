import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { kstDayKey, kstHour, toKstIso } from '../../common/utils/kst';
import { LineTrainPositions } from '../../domain/train-position/models/train-position';
import {
  ITrainPositionProvider,
  TRAIN_POSITION_PROVIDER,
} from '../../domain/train-position/ports/ITrainPositionProvider';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { LineTrainPositionsDto } from './dto/train-positions.dto';

const DEFAULT_LINES = '02';
const DEFAULT_DAILY_BUDGET = 300;
/** 운행 시간(KST 05:00부터 다음 날 01:00까지). 이 밖에는 호출하지 않는다 */
const OPERATING_SECONDS_PER_DAY = 20 * 60 * 60;
/** 서울시 키를 지키려고 간격을 이보다 짧게 잡지 못하게 한다 */
const MIN_INTERVAL_SEC = 10;
/** 가짜 열차는 호출이 없어 짧게 돌려도 된다 */
const MOCK_DEFAULT_INTERVAL_SEC = 5;

export interface TrainPositionSettings {
  enabled: boolean;
  lines: string[];
  dailyBudget: number;
  intervalSec: number;
}

/** 운행 시간(KST 05:00 이후 또는 01:00 전)인지 */
export function isOperatingHour(at: Date | number): boolean {
  const hour = kstHour(at);
  return hour >= 5 || hour < 1;
}

/**
 * 서울시 열차 위치 API를 하루 예산 안에서 직접 폴링해 호선별로 마지막 결과를 들고 있다가 읽는 쪽에 돌려준다.
 * 호출은 한 번에 한 호선씩 설정한 호선을 돌아가며 한다. 서버가 하나라고 가정한다(캐시와 예산이 메모리에 있다)
 */
@Injectable()
export class TrainPositionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrainPositionService.name);
  private readonly latest = new Map<string, LineTrainPositions>();
  private readonly settings: TrainPositionSettings;
  private timer?: NodeJS.Timeout;
  private running = false;
  private cursor = 0;
  private usage = { day: '', count: 0 };
  /** 역 이름으로 같은 호선의 역 ID를 찾는 표 */
  private stationIds?: Map<string, string>;

  constructor(
    @Inject(TRAIN_POSITION_PROVIDER)
    private readonly provider: ITrainPositionProvider,
    private readonly graphService: SubwayGraphService,
    config: ConfigService,
  ) {
    this.settings = TrainPositionService.readSettings(config, provider.source);
  }

  static readSettings(
    config: ConfigService,
    source: 'REALTIME' | 'MOCK',
  ): TrainPositionSettings {
    const lines = String(config.get('TRAIN_POSITION_LINES') ?? DEFAULT_LINES)
      .split(',')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const dailyBudget =
      Number(config.get('TRAIN_POSITION_DAILY_BUDGET')) > 0
        ? Number(config.get('TRAIN_POSITION_DAILY_BUDGET'))
        : DEFAULT_DAILY_BUDGET;
    const configured = Number(config.get('TRAIN_POSITION_INTERVAL_SEC'));
    const automatic =
      source === 'MOCK'
        ? MOCK_DEFAULT_INTERVAL_SEC
        : Math.ceil(OPERATING_SECONDS_PER_DAY / dailyBudget);
    const interval = configured > 0 ? configured : automatic;
    return {
      enabled: String(config.get('TRAIN_POSITION_ENABLED')) === 'true',
      lines,
      dailyBudget,
      // 가짜 열차는 호출이 없어 최소 간격 제한이 필요 없다
      intervalSec: source === 'MOCK' ? interval : Math.max(MIN_INTERVAL_SEC, interval),
    };
  }

  getSettings(): TrainPositionSettings {
    return this.settings;
  }

  onApplicationBootstrap(): void {
    if (!this.settings.enabled) return;
    this.logger.log(
      `Train position polling on: source=${this.provider.source}, lines=${this.settings.lines.join(',')}, every ${this.settings.intervalSec}s, budget=${this.settings.dailyBudget}/day`,
    );
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.settings.intervalSec * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 한 번 폴링한다. 시간이 되지 않았거나 예산이 없으면 아무것도 하지 않는다 */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running || this.settings.lines.length === 0) return;
    const real = this.provider.source === 'REALTIME';
    if (real && !isOperatingHour(now)) return;

    const lineId = this.settings.lines[this.cursor % this.settings.lines.length];
    this.cursor += 1;
    if (!this.provider.supports(lineId)) {
      this.logger.warn(`Train position provider does not support line ${lineId}`);
      return;
    }
    if (real && !this.consumeBudget(now)) return;

    this.running = true;
    try {
      const positions = await this.provider.fetchLine(lineId);
      if (positions) this.latest.set(lineId, positions);
    } catch (error) {
      this.logger.warn(
        `Train position poll failed for ${lineId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** 앱에 돌려줄 한 호선의 마지막 열차 위치. 아직 모았거나 모으는 호선이 아니면 status로 구분한다 */
  getLine(lineId: string, now: Date = new Date()): LineTrainPositionsDto {
    const base = {
      lineId,
      source: this.provider.source,
      pollIntervalSec: this.settings.intervalSec,
    };
    if (!this.settings.lines.includes(lineId)) {
      return { ...base, status: 'UNSUPPORTED_LINE', observedAt: null, ageSec: null, trains: [] };
    }
    const snapshot = this.latest.get(lineId);
    if (!snapshot) {
      return { ...base, status: 'NOT_COLLECTED', observedAt: null, ageSec: null, trains: [] };
    }

    const ids = this.stationIdsByName();
    return {
      ...base,
      source: snapshot.source,
      status: 'OK',
      observedAt: toKstIso(snapshot.observedAt),
      ageSec: Math.max(0, Math.round((now.getTime() - snapshot.observedAt.getTime()) / 1000)),
      trains: snapshot.trains.map((train) => ({
        ...train,
        stationId: ids.get(`${lineId}|${train.stationName}`) ?? null,
      })),
    };
  }

  private consumeBudget(now: Date): boolean {
    const today = kstDayKey(now);
    if (this.usage.day !== today) this.usage = { day: today, count: 0 };
    if (this.usage.count >= this.settings.dailyBudget) {
      if (this.usage.count === this.settings.dailyBudget) {
        this.logger.warn(
          `Train position daily budget reached (${this.settings.dailyBudget}), polling stops until tomorrow`,
        );
        this.usage.count += 1;
      }
      return false;
    }
    this.usage.count += 1;
    return true;
  }

  private stationIdsByName(): Map<string, string> {
    if (this.stationIds) return this.stationIds;
    const graph = this.graphService.getGraph();
    const ids = new Map<string, string>();
    for (let i = 0; i < graph.stationCount; i += 1) {
      const station = graph.station(i);
      const key = `${station.lineId}|${station.stationName}`;
      if (!ids.has(key)) ids.set(key, station.id);
    }
    this.stationIds = ids;
    return ids;
  }
}
