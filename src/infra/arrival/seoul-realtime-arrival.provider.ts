import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { kstDayKey, parseIsoAsKst } from '../../common/utils/kst';
import {
  INextTrainProvider,
  NextTrain,
  NextTrainQuery,
  NextTrainSnapshot,
} from '../../domain/arrival/ports/INextTrainProvider';
import { SEOUL_DIRECTIONS, SEOUL_SUBWAY_IDS } from './seoul-line-codes';

const ENDPOINT = 'http://swopenapi.seoul.go.kr/api/subway';
const TIMEOUT_MS = 3000;
const MAX_ROWS = 30;
const CACHE_TTL_MS = 30_000;
const FAILURE_TTL_MS = 10_000;
const DEFAULT_DAILY_LIMIT = 700;
const MAX_CACHE_ENTRIES = 500;
const PASSED_GRACE_SEC = 60;

interface SeoulArrival {
  subwayId?: string;
  updnLine?: string;
  trainLineNm?: string;
  bstatnNm?: string;
  barvlDt?: string;
  arvlMsg2?: string;
  arvlMsg3?: string;
  arvlCd?: string;
  btrainSttus?: string;
  recptnDt?: string;
}

interface SeoulResponse {
  code?: string;
  errorMessage?: { status?: number; code?: string };
  realtimeArrivalList?: SeoulArrival[];
}

interface CacheEntry {
  expiresAt: number;
  rows: SeoulArrival[] | null;
  observedAt: Date;
}

@Injectable()
export class SeoulRealtimeArrivalProvider implements INextTrainProvider {
  private readonly logger = new Logger(SeoulRealtimeArrivalProvider.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();
  private usage = { day: '', count: 0 };

  constructor(private readonly config: ConfigService) {}

  async fetchNextTrains(query: NextTrainQuery): Promise<NextTrainSnapshot> {
    const subwayId = SEOUL_SUBWAY_IDS[query.lineId];
    if (!subwayId) {
      return {
        source: 'REALTIME',
        status: 'UNSUPPORTED_LINE',
        observedAt: new Date(),
        trains: [],
      };
    }

    const entry = await this.rowsFor(query.stationName);
    if (!entry.rows) {
      return {
        source: 'REALTIME',
        status: 'UNAVAILABLE',
        observedAt: entry.observedAt,
        trains: [],
      };
    }

    return {
      source: 'REALTIME',
      status: 'OK',
      observedAt: entry.observedAt,
      trains: entry.rows
        .filter((row) => row.subwayId === subwayId)
        .flatMap((row) => this.toTrain(row, entry.observedAt.getTime())),
    };
  }

  private async rowsFor(stationName: string): Promise<CacheEntry> {
    const cached = this.cache.get(stationName);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const pending = this.inFlight.get(stationName);
    if (pending) return pending;

    const request = this.load(stationName).finally(() => {
      this.inFlight.delete(stationName);
    });
    this.inFlight.set(stationName, request);
    return request;
  }

  private async load(stationName: string): Promise<CacheEntry> {
    const now = Date.now();
    const key = this.config.get<string>('SEOUL_SUBWAY_REALTIME_API_KEY');
    if (!key) {
      this.logger.warn(
        'SEOUL_SUBWAY_REALTIME_API_KEY is not set, next trains are disabled',
      );
      return { expiresAt: now + FAILURE_TTL_MS, rows: null, observedAt: new Date(now) };
    }
    if (!this.consumeBudget()) {
      return { expiresAt: now + FAILURE_TTL_MS, rows: null, observedAt: new Date(now) };
    }

    let entry: CacheEntry;
    try {
      const url = `${ENDPOINT}/${encodeURIComponent(key)}/json/realtimeStationArrival/0/${MAX_ROWS}/${encodeURIComponent(stationName)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.logger.warn(`Seoul realtime arrival failed: HTTP ${res.status}`);
        entry = { expiresAt: now + FAILURE_TTL_MS, rows: null, observedAt: new Date(now) };
      } else {
        const body = (await res.json()) as SeoulResponse;
        entry = this.fromBody(body, now);
      }
    } catch (error) {
      this.logger.warn(
        `Seoul realtime arrival error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      entry = { expiresAt: now + FAILURE_TTL_MS, rows: null, observedAt: new Date(now) };
    }

    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(stationName, entry);
    return entry;
  }

  // 데이터 없음(INFO-200)은 정상 응답이므로 빈 목록으로 캐시하고, 그 외 오류 코드는 실패로 본다
  private fromBody(body: SeoulResponse, now: number): CacheEntry {
    const code = body.errorMessage?.code ?? body.code;
    if (body.realtimeArrivalList) {
      return {
        expiresAt: now + CACHE_TTL_MS,
        rows: body.realtimeArrivalList,
        observedAt: new Date(now),
      };
    }
    if (code === 'INFO-200') {
      return { expiresAt: now + CACHE_TTL_MS, rows: [], observedAt: new Date(now) };
    }
    this.logger.warn(`Seoul realtime arrival returned ${code ?? 'no list'}`);
    return { expiresAt: now + FAILURE_TTL_MS, rows: null, observedAt: new Date(now) };
  }

  private consumeBudget(): boolean {
    const limit = Number(this.config.get('SEOUL_REALTIME_DAILY_LIMIT')) || DEFAULT_DAILY_LIMIT;
    const today = kstDayKey(Date.now());
    if (this.usage.day !== today) this.usage = { day: today, count: 0 };
    if (this.usage.count >= limit) {
      this.logger.warn(`Seoul realtime daily limit reached (${limit})`);
      return false;
    }
    this.usage.count += 1;
    return true;
  }

  // 도착 예측은 수신 시각(recptnDt) 기준이라 지금까지 흐른 만큼 빼고, 이미 지나간 열차는 버린다
  private toTrain(row: SeoulArrival, observedAtMs: number): NextTrain[] {
    const direction = row.updnLine ? SEOUL_DIRECTIONS[row.updnLine] : undefined;
    const headsign = row.bstatnNm || row.trainLineNm?.split('행')[0];
    if (!direction || !headsign) return [];

    const received = row.recptnDt
      ? parseIsoAsKst(row.recptnDt.replace(' ', 'T')).getTime()
      : NaN;
    const staleSec = Number.isNaN(received)
      ? 0
      : Math.max(0, Math.round((observedAtMs - received) / 1000));

    const predicted = Number(row.barvlDt);
    const arrived = row.arvlCd === '0' || row.arvlCd === '1';
    let arrivalInSec: number | null = null;
    if (arrived) {
      arrivalInSec = 0;
    } else if (predicted > 0) {
      const remaining = predicted - staleSec;
      if (remaining < -PASSED_GRACE_SEC) return [];
      arrivalInSec = Math.max(0, remaining);
    }

    return [
      {
        direction,
        headsign,
        arrivalInSec,
        message: row.arvlMsg2 ?? '',
        isExpress: row.btrainSttus === '급행' || row.btrainSttus === 'ITX',
        ...(row.arvlMsg3 ? { currentLocation: row.arvlMsg3 } : {}),
      },
    ];
  }
}
