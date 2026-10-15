import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { kstDayKey } from '../../common/utils/kst';
import {
  ExternalPlace,
  IPlaceSearchProvider,
} from '../../domain/place/ports/IPlaceSearchProvider';
import { classifyAddressQuery } from './address-query';

const ENDPOINT = 'https://api.vworld.kr/req/search';
const TIMEOUT_MS = 2000;
const DEFAULT_DAILY_LIMIT = 10_000;
// 같은 주소가 동(A동, B동)마다 따로 오므로 합친 뒤에도 limit개가 남도록 넉넉히 받는다
const ADDRESS_OVERFETCH = 3;
const ADDRESS_MAX_SIZE = 50;
const ROAD_ADDRESS_CATEGORY = '도로명주소';
const PARCEL_ADDRESS_CATEGORY = '지번주소';

interface VWorldItem {
  title?: string;
  category?: string;
  address?: {
    road?: string;
    parcel?: string;
    bldnm?: string;
  };
  point?: { x?: string; y?: string };
}

interface VWorldBody {
  status?: string;
  /** `status`가 ERROR일 때 V-World가 알려 주는 사유(예: 키 오류, 등록하지 않은 도메인) */
  error?: { code?: string; text?: string };
  result?: { items?: VWorldItem[] };
}

// V-World 문서는 status, result가 최상위라고 하지만 JSON 예시는 response 아래에 있어 둘 다 처리한다
type VWorldResponse = VWorldBody & { response?: VWorldBody };

const MAX_ERROR_TEXT = 120;

/** 로그에 붙일 오류 사유. 사유가 없으면 빈 문자열이고, 길이는 제한한다(키는 응답에 없지만 길이로도 막는다) */
function describeError(error?: { code?: string; text?: string }): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  const text = typeof error?.text === 'string' ? error.text : '';
  const detail = [code, text]
    .filter(Boolean)
    .join(': ')
    .slice(0, MAX_ERROR_TEXT);
  return detail ? ` (${detail})` : '';
}

@Injectable()
export class VWorldPlaceProvider implements IPlaceSearchProvider {
  private readonly logger = new Logger(VWorldPlaceProvider.name);
  private usage = { day: '', count: 0 };

  constructor(private readonly config: ConfigService) {}

  async search(query: string, limit: number): Promise<ExternalPlace[]> {
    const key = this.config.get<string>('VWORLD_API_KEY');
    if (!key) {
      this.logger.warn('VWORLD_API_KEY is not set, place search is disabled');
      return [];
    }

    const kind = classifyAddressQuery(query);
    // 번지만 있는 입력은 장소 이름으로도 주소로도 찾을 수 없다
    if (kind === 'NUMBER_ONLY') return [];

    if (kind === 'ROAD' || kind === 'PARCEL') {
      const addresses = await this.searchAddress(key, query, limit, kind);
      if (addresses.length > 0) return addresses;
      // 주소로 못 찾으면 장소 이름일 수 있다(예: 이름에 숫자가 들어간 장소)
    }
    return this.searchPlace(key, query, limit);
  }

  private async searchPlace(
    key: string,
    query: string,
    limit: number,
  ): Promise<ExternalPlace[]> {
    const items = await this.request(key, { type: 'PLACE' }, query, limit);
    return items.flatMap((item) => {
      const point = this.pointOf(item);
      if (!item.title || !point) return [];
      return [
        {
          name: item.title,
          address: item.address?.road || item.address?.parcel || '',
          category: item.category,
          ...point,
        },
      ];
    });
  }

  /**
   * 도로명(`ROAD`) 또는 지번(`PARCEL`) 주소 검색. 응답에는 이름(`title`)이 없어 주소를 이름으로 쓰고,
   * 같은 주소가 동마다 반복되므로 하나로 합친다
   */
  private async searchAddress(
    key: string,
    query: string,
    limit: number,
    kind: 'ROAD' | 'PARCEL',
  ): Promise<ExternalPlace[]> {
    const size = Math.min(limit * ADDRESS_OVERFETCH, ADDRESS_MAX_SIZE);
    const items = await this.request(
      key,
      { type: 'ADDRESS', category: kind },
      query,
      size,
    );

    const seen = new Set<string>();
    const places: ExternalPlace[] = [];
    for (const item of items) {
      const point = this.pointOf(item);
      const address = item.address;
      if (!point || !address) continue;

      const road = (address.road ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      const parcel = (address.parcel ?? '').trim();
      const building = (address.bldnm ?? '').trim();
      const isRoad = kind === 'ROAD';
      const name = isRoad ? road : parcel;
      if (!name) continue;

      const detail = [isRoad ? parcel : road, building]
        .filter((part) => part.length > 0)
        .join(' ');
      const dedupeKey = `${name}|${detail}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      places.push({
        name,
        address: detail,
        category: isRoad ? ROAD_ADDRESS_CATEGORY : PARCEL_ADDRESS_CATEGORY,
        ...point,
      });
      if (places.length >= limit) break;
    }
    return places;
  }

  private pointOf(item: VWorldItem): { lat: number; lng: number } | undefined {
    const lng = Number(item.point?.x);
    const lat = Number(item.point?.y);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  }

  /** V-World 검색을 한 번 부른다. 실패하거나 일일 호출 수를 넘었으면 빈 목록이다 */
  private async request(
    key: string,
    kind: { type: 'PLACE' | 'ADDRESS'; category?: string },
    query: string,
    size: number,
  ): Promise<VWorldItem[]> {
    if (!this.consumeBudget()) return [];
    const params = new URLSearchParams({
      service: 'search',
      request: 'search',
      version: '2.0',
      crs: 'EPSG:4326',
      type: kind.type,
      format: 'json',
      size: String(size),
      page: '1',
      query,
    });
    if (kind.category) params.set('category', kind.category);
    const { url, headers } = this.target(key, params);
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`V-World search failed: HTTP ${res.status}`);
        return [];
      }
      const parsed = (await res.json()) as VWorldResponse;
      const body = parsed.response ?? parsed;
      if (body.status !== 'OK') {
        if (body.status === 'ERROR') {
          this.logger.warn(
            `V-World search returned status ERROR${describeError(body.error)}`,
          );
        }
        return [];
      }
      return body.result?.items ?? [];
    } catch (error) {
      this.logger.warn(
        `V-World search error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return [];
    }
  }

  /**
   * 호출 주소와 헤더. 해외 IP를 V-World가 막으므로 `VWORLD_PROXY_URL`이 있으면 한국에 있는 중계 서버로 보낸다.
   * 중계 서버에는 키를 URL이 아니라 헤더로 보내(로그에 남지 않게) 중계 서버가 V-World를 부를 때 쿼리에 붙인다.
   * 없으면 V-World를 직접 부르고 키는 쿼리에 붙인다
   */
  private target(
    key: string,
    params: URLSearchParams,
  ): { url: string; headers?: Record<string, string> } {
    const proxy = this.config.get<string>('VWORLD_PROXY_URL');
    if (!proxy) {
      params.set('key', key);
      return { url: `${ENDPOINT}?${params.toString()}` };
    }
    const secret = this.config.get<string>('VWORLD_PROXY_SECRET');
    return {
      url: `${proxy}${proxy.includes('?') ? '&' : '?'}${params.toString()}`,
      headers: {
        'X-Vworld-Key': key,
        ...(secret ? { 'X-Proxy-Secret': secret } : {}),
      },
    };
  }

  // 키가 도는 일일 호출 수를 넘으면 외부 호출을 멈추고 역 결과만 돌려준다. 재시작하면 0부터 다시 센다
  private consumeBudget(): boolean {
    const configured = Number(this.config.get('VWORLD_DAILY_LIMIT'));
    const limit = configured > 0 ? configured : DEFAULT_DAILY_LIMIT;
    const today = kstDayKey(Date.now());
    if (this.usage.day !== today) this.usage = { day: today, count: 0 };
    if (this.usage.count >= limit) {
      this.logger.warn(`V-World daily limit reached (${limit}), place search is stations only`);
      return false;
    }
    this.usage.count += 1;
    return true;
  }
}
