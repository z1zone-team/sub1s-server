import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IHolidayCalendar } from '../../domain/arrival/ports/IHolidayCalendar';

const ENDPOINT =
  'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const TIMEOUT_MS = 3000;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 36;

interface HolidayItem {
  locdate?: number | string;
  isHoliday?: string;
}

interface HolidayResponse {
  response?: {
    header?: { resultCode?: string };
    body?: { items?: { item?: HolidayItem | HolidayItem[] } | '' };
  };
}

interface MonthEntry {
  expiresAt: number;
  days: Set<string>;
}

@Injectable()
export class PublicDataHolidayCalendar implements IHolidayCalendar {
  private readonly logger = new Logger(PublicDataHolidayCalendar.name);
  private readonly months = new Map<string, MonthEntry>();
  private readonly inFlight = new Map<string, Promise<MonthEntry>>();

  constructor(private readonly config: ConfigService) {}

  async isPublicHoliday(dayKey: string): Promise<boolean> {
    const month = dayKey.slice(0, 7);
    const cached = this.months.get(month);
    if (cached && cached.expiresAt > Date.now()) return cached.days.has(dayKey);

    let pending = this.inFlight.get(month);
    if (!pending) {
      pending = this.load(month).finally(() => this.inFlight.delete(month));
      this.inFlight.set(month, pending);
    }
    return (await pending).days.has(dayKey);
  }

  private async load(month: string): Promise<MonthEntry> {
    const now = Date.now();
    const failed: MonthEntry = { expiresAt: now + FAILURE_TTL_MS, days: new Set() };
    const key = this.config.get<string>('PUBLIC_DATA_API_KEY');
    if (!key) {
      this.logger.warn('PUBLIC_DATA_API_KEY is not set, holidays are not checked');
      return this.store(month, failed);
    }

    const [year, mm] = month.split('-');
    const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
    const url = `${ENDPOINT}?solYear=${year}&solMonth=${mm}&_type=json&numOfRows=50&ServiceKey=${serviceKey}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.logger.warn(`Holiday calendar failed: HTTP ${res.status}`);
        return this.store(month, failed);
      }
      const body = (await res.json()) as HolidayResponse;
      if (body.response?.header?.resultCode !== '00') {
        this.logger.warn(
          `Holiday calendar returned ${body.response?.header?.resultCode ?? 'no header'}`,
        );
        return this.store(month, failed);
      }
      return this.store(month, {
        expiresAt: now + SUCCESS_TTL_MS,
        days: this.toDays(body),
      });
    } catch (error) {
      this.logger.warn(
        `Holiday calendar error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return this.store(month, failed);
    }
  }

  private toDays(body: HolidayResponse): Set<string> {
    const items = body.response?.body?.items;
    const raw = items && typeof items === 'object' ? items.item : undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const days = new Set<string>();
    for (const item of list) {
      const date = String(item.locdate ?? '');
      if (item.isHoliday === 'Y' && /^\d{8}$/.test(date)) {
        days.add(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
      }
    }
    return days;
  }

  private store(month: string, entry: MonthEntry): MonthEntry {
    if (this.months.size >= MAX_CACHE_ENTRIES) this.months.clear();
    this.months.set(month, entry);
    return entry;
  }
}
