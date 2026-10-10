import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExternalPlace,
  IPlaceSearchProvider,
} from '../../domain/place/ports/IPlaceSearchProvider';

const ENDPOINT = 'https://api.vworld.kr/req/search';
const TIMEOUT_MS = 2000;

interface VWorldItem {
  title?: string;
  category?: string;
  address?: { road?: string; parcel?: string };
  point?: { x?: string; y?: string };
}

interface VWorldBody {
  status?: string;
  result?: { items?: VWorldItem[] };
}

// The V-World docs list `status` and `result` at the top level while its JSON samples nest them under `response`.
type VWorldResponse = VWorldBody & { response?: VWorldBody };

// Relays V-World search results without storing them. Any failure degrades to an empty list so station results still show.
@Injectable()
export class VWorldPlaceProvider implements IPlaceSearchProvider {
  private readonly logger = new Logger(VWorldPlaceProvider.name);

  constructor(private readonly config: ConfigService) {}

  async search(query: string, limit: number): Promise<ExternalPlace[]> {
    const key = this.config.get<string>('VWORLD_API_KEY');
    if (!key) {
      this.logger.warn('VWORLD_API_KEY is not set, place search is disabled');
      return [];
    }
    const params = new URLSearchParams({
      service: 'search',
      request: 'search',
      version: '2.0',
      crs: 'EPSG:4326',
      type: 'PLACE',
      format: 'json',
      size: String(limit),
      page: '1',
      query,
      key,
    });
    try {
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
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
          this.logger.warn('V-World search returned status ERROR');
        }
        return [];
      }
      return (body.result?.items ?? []).flatMap((item) => {
        const lng = Number(item.point?.x);
        const lat = Number(item.point?.y);
        if (!item.title || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          return [];
        }
        return [
          {
            name: item.title,
            address: item.address?.road || item.address?.parcel || '',
            category: item.category,
            lat,
            lng,
          },
        ];
      });
    } catch (error) {
      this.logger.warn(
        `V-World search error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return [];
    }
  }
}
