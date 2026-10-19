import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { getSubwayDataPath } from '../../common/utils/subway-data-path';
import { composeTrackPath } from '../../domain/subway/services/track-path';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';

/**
 * 열차 구간이 지나는 역들을 실제 선로 모양으로 이은 폴리라인(`edge-shapes.json`, OpenStreetMap 기반).
 * 선로 모양을 모르는 구간은 앱이 역 좌표를 직선으로 그리므로 path를 주지 않는다
 */
@Injectable()
export class TrackPathService {
  private shapes?: Record<string, string>;

  constructor(private readonly graphService: SubwayGraphService) {}

  private loadShapes(): Record<string, string> {
    if (!this.shapes) {
      try {
        this.shapes = JSON.parse(readFileSync(getSubwayDataPath('edge-shapes.json'), 'utf-8')) as Record<string, string>;
      } catch {
        this.shapes = {};
      }
    }
    return this.shapes;
  }

  pathFor(stationIds: readonly string[]): string | undefined {
    if (stationIds.length < 2) return undefined;
    const graph = this.graphService.getGraph();
    return composeTrackPath(stationIds, this.loadShapes(), (id) => {
      const index = graph.indexOf(id);
      if (index === undefined) return undefined;
      const station = graph.station(index);
      return { lat: station.lat, lng: station.lng };
    });
  }
}
