import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseIsoAsKst } from '../../common/utils/kst';
import {
  OperationNotice,
  parseLineIds,
} from '../../domain/operation/models/operation-status';
import { IOperationNoticeProvider } from '../../domain/operation/ports/IOperationNoticeProvider';

const ENDPOINT = 'https://apis.data.go.kr/B553766/ntce/getNtceList';
const PAGE_SIZE = 100;
const TIMEOUT_MS = 3000;
// 원본이 1분마다 갱신된다
const FRESH_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10_000;
// 가져오지 못해도 이 시간 안의 이전 결과는 계속 쓴다. 그보다 오래되면 모른다고 답한다
const STALE_LIMIT_MS = 10 * 60_000;

// 직접 만든 오류만 메시지를 로그에 남긴다. 네트워크 오류 메시지에는 키가 든 요청 주소가 들어올 수 있다
class NoticeFailure extends Error {}

interface NoticeItem {
  noftTtl?: string;
  noftOcrnDt?: string;
  noftSeCd?: string;
  lineNmLst?: string | null;
}

interface NoticeResponse {
  response?: {
    header?: { resultCode?: string };
    body?: { items?: { item?: NoticeItem | NoticeItem[] } | '' };
  };
}

@Injectable()
export class DataGoKrNoticeProvider implements IOperationNoticeProvider {
  private readonly logger = new Logger(DataGoKrNoticeProvider.name);
  private cache?: { fetchedAt: number; notices: OperationNotice[] };
  private lastFailureAt = 0;
  private inFlight?: Promise<void>;

  constructor(private readonly config: ConfigService) {}

  async fetchRecentNotices(): Promise<OperationNotice[] | null> {
    const now = Date.now();
    const fresh = this.cache && now - this.cache.fetchedAt < FRESH_MS;
    const cooling = now - this.lastFailureAt < RETRY_AFTER_FAILURE_MS;

    if (!fresh && !cooling) {
      this.inFlight ??= this.refresh().finally(() => {
        this.inFlight = undefined;
      });
      await this.inFlight;
    }

    if (this.cache && Date.now() - this.cache.fetchedAt < STALE_LIMIT_MS) {
      return this.cache.notices;
    }
    return null;
  }

  private async refresh(): Promise<void> {
    const key = this.config.get<string>('PUBLIC_DATA_API_KEY');
    if (!key) {
      this.logger.warn('PUBLIC_DATA_API_KEY is not set, operation status is unknown');
      this.lastFailureAt = Date.now();
      return;
    }

    const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
    const url = `${ENDPOINT}?serviceKey=${serviceKey}&pageNo=1&numOfRows=${PAGE_SIZE}&dataType=JSON`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new NoticeFailure(`HTTP ${res.status}`);
      const body = (await res.json()) as NoticeResponse;
      if (body.response?.header?.resultCode !== '00') {
        throw new NoticeFailure(`result ${body.response?.header?.resultCode ?? 'missing'}`);
      }
      this.cache = { fetchedAt: Date.now(), notices: this.toNotices(body) };
    } catch (error) {
      this.lastFailureAt = Date.now();
      this.logger.warn(
        `Operation notices failed: ${
          error instanceof NoticeFailure
            ? error.message
            : error instanceof Error
              ? error.name
              : 'unknown'
        }`,
      );
    }
  }

  private toNotices(body: NoticeResponse): OperationNotice[] {
    const items = body.response?.body?.items;
    const raw = items && typeof items === 'object' ? items.item : undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return list.flatMap((item) => {
      const occurredAt = item.noftOcrnDt ? parseIsoAsKst(item.noftOcrnDt).getTime() : NaN;
      if (!item.noftTtl || Number.isNaN(occurredAt)) return [];
      return [
        {
          title: item.noftTtl,
          occurredAt,
          categoryCode: item.noftSeCd ?? '',
          lineIds: parseLineIds(item.lineNmLst),
        },
      ];
    });
  }
}
