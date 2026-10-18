import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrainDirection } from '../../domain/arrival/ports/INextTrainProvider';
import {
  LineTrainPositions,
  TrainPosition,
  TrainPositionStatus,
} from '../../domain/train-position/models/train-position';
import { ITrainPositionProvider } from '../../domain/train-position/ports/ITrainPositionProvider';

const ENDPOINT = 'http://swopenapi.seoul.go.kr/api/subway';
const TIMEOUT_MS = 5000;
// 한 호선의 열차는 많아도 100대 안팎이다. 한 번의 호출로 다 받는다
const MAX_ROWS = 1000;

/** 서울시 열차 위치 API가 호선을 가리키는 이름. 1~9호선만 확인했다 */
const LINE_NAMES: Readonly<Record<string, string>> = {
  '01': '1호선',
  '02': '2호선',
  '03': '3호선',
  '04': '4호선',
  '05': '5호선',
  '06': '6호선',
  '07': '7호선',
  '08': '8호선',
  '09': '9호선',
};
// 순환선은 상행, 하행 대신 내선, 외선으로 부른다
const LOOP_LINES = new Set(['02']);

const STATUSES: Readonly<Record<string, TrainPositionStatus>> = {
  '0': 'ENTERING',
  '1': 'ARRIVED',
  '2': 'DEPARTED',
  '3': 'LEFT_PREVIOUS',
};

interface SeoulPositionRow {
  trainNo?: string;
  statnNm?: string;
  statnTnm?: string;
  updnLine?: string;
  trainSttus?: string;
  directAt?: string;
  lstcarAt?: string;
}

interface SeoulPositionResponse {
  errorMessage?: { code?: string };
  realtimePositionList?: SeoulPositionRow[];
}

/** 서울시 실시간 지하철 열차 위치정보(`realtimePosition`)를 호선 단위로 가져온다 */
@Injectable()
export class SeoulTrainPositionProvider implements ITrainPositionProvider {
  readonly source = 'REALTIME' as const;
  private readonly logger = new Logger(SeoulTrainPositionProvider.name);

  constructor(private readonly config: ConfigService) {}

  supports(lineId: string): boolean {
    return lineId in LINE_NAMES;
  }

  async fetchLine(lineId: string): Promise<LineTrainPositions | null> {
    const name = LINE_NAMES[lineId];
    const key = this.config.get<string>('SEOUL_SUBWAY_REALTIME_API_KEY');
    if (!name || !key) {
      if (!key) {
        this.logger.warn(
          'SEOUL_SUBWAY_REALTIME_API_KEY is not set, train positions are unavailable',
        );
      }
      return null;
    }

    try {
      const url = `${ENDPOINT}/${key}/json/realtimePosition/0/${MAX_ROWS}/${encodeURIComponent(name)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.logger.warn(`Seoul train position failed: HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as SeoulPositionResponse;
      const code = body.errorMessage?.code;
      if (code !== 'INFO-000' && code !== 'INFO-200') {
        // INFO-200은 해당 데이터가 없는 경우다. 키가 들어 있는 주소는 로그에 남기지 않는다
        this.logger.warn(`Seoul train position returned ${code ?? 'no code'}`);
        return null;
      }
      return {
        lineId,
        source: this.source,
        observedAt: new Date(),
        trains: (body.realtimePositionList ?? []).flatMap((row) =>
          this.toTrain(lineId, row),
        ),
      };
    } catch (error) {
      this.logger.warn(
        `Seoul train position error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return null;
    }
  }

  private toTrain(lineId: string, row: SeoulPositionRow): TrainPosition[] {
    if (!row.trainNo || !row.statnNm) return [];
    return [
      {
        trainNo: row.trainNo,
        stationName: row.statnNm,
        status: STATUSES[row.trainSttus ?? ''] ?? 'UNKNOWN',
        direction: this.directionOf(lineId, row.updnLine),
        destinationName: this.destinationOf(row.statnTnm),
        isExpress: row.directAt === '1',
        isLastTrain: row.lstcarAt === '1',
      },
    ];
  }

  // updnLine 0은 상행 또는 내선, 1은 하행 또는 외선이다
  private directionOf(lineId: string, updnLine?: string): TrainDirection {
    const down = updnLine === '1';
    if (LOOP_LINES.has(lineId)) return down ? 'OUTER' : 'INNER';
    return down ? 'DOWN' : 'UP';
  }

  // 종착역은 "성수종착"처럼 붙어 오기도 해서 뒤의 "종착"을 뗀다
  private destinationOf(value?: string): string {
    return (value ?? '').replace(/종착$/, '').trim();
  }
}
