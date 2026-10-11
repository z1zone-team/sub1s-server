import { Inject, Injectable, Logger } from '@nestjs/common';
import { toKstIso } from '../../common/utils/kst';
import {
  LineStation,
  OperationNotice,
  OperationStatus,
  findActiveIncidents,
  operationOfSegment,
  summarizeOperation,
} from '../../domain/operation/models/operation-status';
import {
  IOperationNoticeProvider,
  OPERATION_NOTICE_PROVIDER,
} from '../../domain/operation/ports/IOperationNoticeProvider';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  OperationNoticeDto,
  SubwayRouteOptionDto,
} from './dto/route-search-response.dto';

const WALK_LINE_ID = 'WALK';

@Injectable()
export class OperationStatusService {
  private readonly logger = new Logger(OperationStatusService.name);
  private readonly lineStationsCache = new WeakMap<SubwayGraph, Map<string, LineStation[]>>();

  constructor(
    @Inject(OPERATION_NOTICE_PROVIDER)
    private readonly noticeProvider: IOperationNoticeProvider,
  ) {}

  /** 구간과 경로의 operationStatus를 채운다. 어떤 문제가 있어도 경로 검색을 실패시키지 않고 UNKNOWN으로 둔다 */
  async annotate(options: SubwayRouteOptionDto[], graph: SubwayGraph): Promise<void> {
    try {
      const notices = await this.noticeProvider.fetchRecentNotices();
      const incidents = notices
        ? findActiveIncidents(notices, (lineId) => this.stationsOfLine(graph, lineId), Date.now())
        : [];

      for (const option of options) {
        const rideStatuses: OperationStatus[] = [];
        let firstNotice: OperationNotice | undefined;

        for (const segment of option.segments) {
          if (segment.lineId === WALK_LINE_ID) continue;
          const result = operationOfSegment(
            segment.lineId,
            this.segmentStations(option, segment.fromStationId, segment.toStationId),
            incidents,
            notices !== null,
          );
          segment.operationStatus = result.status;
          if (result.notice) {
            segment.operationNotice = this.toDto(result.notice);
            firstNotice ??= result.notice;
          }
          rideStatuses.push(result.status);
        }

        option.operationStatus = summarizeOperation(rideStatuses);
        if (firstNotice) option.operationNotice = this.toDto(firstNotice);
      }
    } catch (error) {
      this.logger.warn(`Operation status skipped: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  // 경로의 역 순서에서 이 구간이 지나는 역들. 순서를 알 수 없으면 양 끝 역만 본다
  private segmentStations(option: SubwayRouteOptionDto, fromId: string, toId: string): Set<string> {
    const ids = option.stationIds ?? [];
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId, Math.max(from, 0));
    return from >= 0 && to >= from ? new Set(ids.slice(from, to + 1)) : new Set([fromId, toId]);
  }

  private stationsOfLine(graph: SubwayGraph, lineId: string): LineStation[] {
    let byLine = this.lineStationsCache.get(graph);
    if (!byLine) {
      byLine = new Map();
      for (let i = 0; i < graph.stationCount; i += 1) {
        const station = graph.station(i);
        const list = byLine.get(station.lineId) ?? [];
        list.push({ id: station.id, name: station.stationName, lineSeq: station.lineSeq ?? i });
        byLine.set(station.lineId, list);
      }
      this.lineStationsCache.set(graph, byLine);
    }
    return byLine.get(lineId) ?? [];
  }

  private toDto(notice: OperationNotice): OperationNoticeDto {
    return { title: notice.title, occurredAt: toKstIso(notice.occurredAt) };
  }
}
