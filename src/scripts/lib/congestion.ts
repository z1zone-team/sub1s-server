import { normalize } from './subway-common';

export const DAY_TYPES = ['WEEKDAY', 'SATURDAY', 'SUNDAY'] as const;
export type DayType = (typeof DAY_TYPES)[number];

// 30-minute slots from 05:30 to 25:00 (01:00 the next day), as in the Seoul Metro congestion data
export const SLOT_COUNT = 39;

export interface CongestionSheetRow {
  line: string;
  stationNo: number;
  stationName: string;
  direction: string;
  rates: number[];
}

export interface CongestionRecord {
  stationId: string;
  lineId: string;
  direction: 'UP' | 'DOWN' | 'INNER' | 'OUTER';
  dayType: DayType;
  // 30-minute average congestion in percent, exactly as published (100 = full capacity, can exceed 100)
  rates: number[];
}

export interface StationKey {
  id: string;
  lineId: string;
  stationName: string;
}

const LINE_IDS: Record<string, string> = {
  '1호선': '01',
  '2호선': '02',
  '3호선': '03',
  '4호선': '04',
  '5호선': '05',
  '6호선': '06',
  '7호선': '07',
  '8호선': '08',
};

const DIRECTIONS: Record<string, CongestionRecord['direction']> = {
  상선: 'UP',
  하선: 'DOWN',
  내선: 'INNER',
  외선: 'OUTER',
};

// station numbers of 9000 and above are special start points of branches and loops (성수E, 응암S, ...)
const SPECIAL_CODE_FROM = 9000;

function nameKey(name: string): string {
  const base = normalize(name);
  return base.endsWith('역') && base.length > 2 ? base.slice(0, -1) : base;
}

// Converts the rows of the three sheets to records keyed by our station ids. Rates are never changed
// (the data is published under a no-derivatives license), only the keys are translated.
export function buildCongestionRecords(
  sheets: Record<DayType, CongestionSheetRow[]>,
  stations: StationKey[],
): {
  records: CongestionRecord[];
  skipped: { specialCode: number; unmatched: string[] };
} {
  const byKey = new Map<string, StationKey>(
    stations.map((s) => [`${s.lineId}|${nameKey(s.stationName)}`, s]),
  );
  const records: CongestionRecord[] = [];
  const seen = new Set<string>();
  const unmatched = new Set<string>();
  let specialCode = 0;

  for (const dayType of DAY_TYPES) {
    for (const row of sheets[dayType]) {
      const lineId = LINE_IDS[row.line];
      if (!lineId) throw new Error(`unknown line: ${row.line}`);
      const direction = DIRECTIONS[row.direction];
      if (!direction) throw new Error(`unknown direction: ${row.direction}`);
      if (
        row.rates.length !== SLOT_COUNT ||
        row.rates.some((v) => !Number.isFinite(v))
      ) {
        throw new Error(
          `expected ${SLOT_COUNT} slots of numbers for ${row.line} ${row.stationName}`,
        );
      }

      if (row.stationNo >= SPECIAL_CODE_FROM) {
        specialCode += 1;
        continue;
      }
      const station = byKey.get(`${lineId}|${nameKey(row.stationName)}`);
      if (!station) {
        unmatched.add(`${lineId}|${row.stationName}`);
        continue;
      }
      const key = `${dayType}|${station.id}|${direction}`;
      if (seen.has(key)) {
        throw new Error(`duplicate congestion row: ${key}`);
      }
      seen.add(key);
      records.push({
        stationId: station.id,
        lineId,
        direction,
        dayType,
        rates: row.rates,
      });
    }
  }

  return {
    records,
    skipped: { specialCode, unmatched: [...unmatched].sort() },
  };
}
