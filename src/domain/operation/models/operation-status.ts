export type OperationStatus = 'NORMAL' | 'DISRUPTED' | 'UNKNOWN';

export interface OperationNotice {
  title: string;
  /** epoch ms */
  occurredAt: number;
  categoryCode: string;
  lineIds: string[];
}

export interface LineStation {
  id: string;
  name: string;
  lineSeq: number;
}

export interface ActiveIncident {
  notice: OperationNotice;
  lineId: string;
  /** 제목에서 찾은 영향 역. null이면 노선 전체로 본다 */
  stationIds: Set<string> | null;
}

export interface SegmentOperation {
  status: OperationStatus;
  notice?: OperationNotice;
}

/** 공지가 빠짐없이 올라온다고 보는 노선. 이 노선에서 공지가 없을 때만 NORMAL이라고 한다 */
export const FULL_COVERAGE_LINES: readonly string[] = ['01', '02', '03', '04', '05', '06', '07', '08', 'UI'];

/** 해제 공지가 없어도 이 시간이 지난 사고는 진행 중으로 보지 않는다 */
export const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

/** 구분코드 1~6은 사고, 지연, 무정차와 그 해제. 7(시간표), 8(운행계획 안내)은 사고가 아니다 */
const INCIDENT_CODES = new Set(['1', '2', '3', '4', '5', '6']);

const RESOLUTION_PATTERN = /조치\s?완료|복구\s?완료|진화\s?완료|정상\s?운행|정상\s?화|정상\s?운영|운행\s?재개|운행\s?개시|통과\s?종료|무정차\s?종료|해소|해제|완료|종료/;

const LINE_NAME_PATTERN = /^(\d)호선$/;

export function isResolutionTitle(title: string): boolean {
  return RESOLUTION_PATTERN.test(title);
}

/** "1호선, 4호선"처럼 쉼표로 이어진 호선 이름을 우리 노선 ID로 바꾼다 */
export function parseLineIds(lineNames: string | null | undefined): string[] {
  if (!lineNames) return [];
  const ids = new Set<string>();
  for (const part of lineNames.split(',')) {
    const name = part.trim();
    const numbered = LINE_NAME_PATTERN.exec(name);
    if (numbered) ids.add(`0${numbered[1]}`);
    else if (name === '우이신설선') ids.add('UI');
  }
  return [...ids];
}

/**
 * 공지 제목의 역 이름을 이 노선의 역과 맞춘다. "남영~구로역간"처럼 구간이면 사이의 역을 모두 포함한다.
 * 찾지 못하면 null이고, 이때는 노선 전체에 영향이 있다고 본다.
 * 공지의 역 코드는 우리 코드와 달라(5호선 여의나루가 마포로 매칭되는 등) 쓰지 않는다
 */
export function affectedStationIds(title: string, lineStations: LineStation[]): Set<string> | null {
  const byName = new Map<string, LineStation[]>();
  for (const station of lineStations) {
    const list = byName.get(station.name) ?? [];
    list.push(station);
    byName.set(station.name, list);
  }

  const found = new Set<string>();
  const range = /([가-힣0-9]+)역?\s?~\s?([가-힣0-9]+)역/.exec(title);
  if (range) {
    const from = byName.get(range[1])?.[0];
    const to = byName.get(range[2])?.[0];
    if (from && to) {
      const [low, high] = from.lineSeq <= to.lineSeq ? [from.lineSeq, to.lineSeq] : [to.lineSeq, from.lineSeq];
      for (const station of lineStations) {
        if (station.lineSeq >= low && station.lineSeq <= high) found.add(station.id);
      }
    }
  }

  for (const token of title.match(/[가-힣0-9]+(?=역(?:간|(?![가-힣])))/g) ?? []) {
    for (const station of byName.get(token) ?? []) found.add(station.id);
  }
  return found.size > 0 ? found : null;
}

/**
 * 시간 순으로 훑으면서 사고 공지는 진행 중 목록에 넣고, 같은 노선에서 겹치는 역(또는 한쪽이 노선 전체)을 가리키는 해제 공지는 그 사고를 지운다
 */
export function findActiveIncidents(
  notices: OperationNotice[],
  stationsOfLine: (lineId: string) => LineStation[],
  now: number,
): ActiveIncident[] {
  const recent = notices
    .filter(
      (notice) =>
        INCIDENT_CODES.has(notice.categoryCode) &&
        notice.lineIds.length > 0 &&
        notice.occurredAt <= now &&
        now - notice.occurredAt < ACTIVE_WINDOW_MS,
    )
    .sort((a, b) => a.occurredAt - b.occurredAt);

  let active: ActiveIncident[] = [];
  for (const notice of recent) {
    for (const lineId of notice.lineIds) {
      const stationIds = affectedStationIds(notice.title, stationsOfLine(lineId));
      if (isResolutionTitle(notice.title)) {
        active = active.filter((incident) => !(incident.lineId === lineId && overlaps(incident.stationIds, stationIds)));
      } else {
        active.push({ notice, lineId, stationIds });
      }
    }
  }
  return active;
}

function overlaps(a: Set<string> | null, b: Set<string> | null): boolean {
  if (a === null || b === null) return true;
  for (const id of a) if (b.has(id)) return true;
  return false;
}

/**
 * 탑승 구간의 운행 상태. 진행 중인 사고가 이 노선 전체에 걸리거나 이 구간의 역을 포함하면 DISRUPTED,
 * 공지가 빠짐없이 오는 노선에서 사고가 없을 때만 NORMAL이고 그 밖에는 UNKNOWN이다
 */
export function operationOfSegment(
  lineId: string,
  segmentStationIds: ReadonlySet<string>,
  incidents: ActiveIncident[],
  noticesAvailable: boolean,
): SegmentOperation {
  if (!noticesAvailable) return { status: 'UNKNOWN' };

  const hit = incidents.find(
    (incident) =>
      incident.lineId === lineId &&
      (incident.stationIds === null || [...incident.stationIds].some((id) => segmentStationIds.has(id))),
  );
  if (hit) return { status: 'DISRUPTED', notice: hit.notice };
  return { status: FULL_COVERAGE_LINES.includes(lineId) ? 'NORMAL' : 'UNKNOWN' };
}

/** 경로 전체의 상태: 하나라도 DISRUPTED면 DISRUPTED, 모두 NORMAL일 때만 NORMAL, 나머지는 UNKNOWN */
export function summarizeOperation(statuses: OperationStatus[]): OperationStatus {
  if (statuses.includes('DISRUPTED')) return 'DISRUPTED';
  if (statuses.length > 0 && statuses.every((status) => status === 'NORMAL')) return 'NORMAL';
  return 'UNKNOWN';
}
