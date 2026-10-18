import { Injectable } from '@nestjs/common';
import { TrainDirection } from '../../domain/arrival/ports/INextTrainProvider';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  LineTrainPositions,
  TrainPosition,
  TrainPositionStatus,
} from '../../domain/train-position/models/train-position';
import { ITrainPositionProvider } from '../../domain/train-position/ports/ITrainPositionProvider';

/** 한 역에서 다음 역까지 가는 데 걸리는 시간(초). 가짜 열차는 이 속도로 움직인다 */
const STEP_SEC = 90;
const MAX_TRAINS_PER_DIRECTION = 6;
const MIN_STATIONS = 4;
const LOOP_LINES = new Set(['02']);

/**
 * 시연용 가짜 열차. 외부 호출 없이 현재 시각에 따라 호선 위를 움직이는 열차를 만들어 준다.
 * 같은 시각이면 항상 같은 결과다(난수를 쓰지 않는다)
 */
@Injectable()
export class MockTrainPositionProvider implements ITrainPositionProvider {
  readonly source = 'MOCK' as const;

  constructor(private readonly graphService: SubwayGraphService) {}

  supports(lineId: string): boolean {
    return this.stationNames(lineId).length >= MIN_STATIONS;
  }

  async fetchLine(lineId: string, now = new Date()): Promise<LineTrainPositions | null> {
    const names = this.stationNames(lineId);
    if (names.length < MIN_STATIONS) return null;

    const perDirection = Math.min(
      MAX_TRAINS_PER_DIRECTION,
      Math.max(1, Math.floor(names.length / 6)),
    );
    const loop = LOOP_LINES.has(lineId);
    const trains: TrainPosition[] = [];
    const steps = now.getTime() / 1000 / STEP_SEC;

    for (const forward of [true, false]) {
      for (let k = 0; k < perDirection; k += 1) {
        const offset = (k * names.length) / perDirection;
        trains.push(
          this.trainAt(lineId, names, loop, forward, k, steps + offset),
        );
      }
    }
    return { lineId, source: this.source, observedAt: now, trains };
  }

  private trainAt(
    lineId: string,
    names: string[],
    loop: boolean,
    forward: boolean,
    k: number,
    steps: number,
  ): TrainPosition {
    const n = names.length;
    const whole = Math.floor(steps);
    const fraction = steps - whole;

    // 순환선은 한 방향으로 계속 돌고, 그 밖의 호선은 끝에서 되돌아온다
    let index: number;
    let movingForward = forward;
    if (loop) {
      const at = whole % n;
      index = forward ? at : n - 1 - at;
    } else {
      const period = 2 * (n - 1);
      const at = whole % period;
      const goingOut = at < n - 1;
      const along = goingOut ? at : period - at;
      index = forward ? along : n - 1 - along;
      movingForward = forward === goingOut;
    }

    const status = this.statusOf(fraction);
    // 전역출발은 다음 역을 가리킨다
    const ahead = movingForward ? 1 : -1;
    const stationIndex =
      status === 'LEFT_PREVIOUS'
        ? (((index + ahead) % n) + n) % n
        : index;
    const destination = loop
      ? ''
      : movingForward
        ? names[n - 1]
        : names[0];

    return {
      trainNo: `${lineId}${String(forward ? 1000 + k : 2000 + k)}`,
      stationName: names[stationIndex],
      status,
      direction: this.directionOf(lineId, loop, movingForward),
      destinationName: destination,
      isExpress: false,
      isLastTrain: false,
    };
  }

  // 한 구간을 가는 동안 진입, 도착, 출발, 전역출발 순서로 바뀐다
  private statusOf(fraction: number): TrainPositionStatus {
    if (fraction < 0.15) return 'ENTERING';
    if (fraction < 0.45) return 'ARRIVED';
    if (fraction < 0.6) return 'DEPARTED';
    return 'LEFT_PREVIOUS';
  }

  private directionOf(lineId: string, loop: boolean, forward: boolean): TrainDirection {
    if (loop) return forward ? 'OUTER' : 'INNER';
    return forward ? 'DOWN' : 'UP';
  }

  private stationNames(lineId: string): string[] {
    const graph = this.graphService.getGraph();
    const stations: Array<{ name: string; seq: number }> = [];
    for (let i = 0; i < graph.stationCount; i += 1) {
      const station = graph.station(i);
      if (station.lineId === lineId) {
        stations.push({ name: station.stationName, seq: station.lineSeq ?? i });
      }
    }
    return stations.sort((a, b) => a.seq - b.seq).map((s) => s.name);
  }
}
