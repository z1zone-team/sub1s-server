import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Workbook } from 'exceljs';
import {
  CongestionSheetRow,
  DAY_TYPES,
  DayType,
  SLOT_COUNT,
  buildCongestionRecords,
} from './lib/congestion';
import { OUT_DIR, RAW_DIR, loadStations } from './lib/subway-common';

// 서울교통공사_지하철혼잡도정보 (OA-12928). The file is downloaded by hand into data-raw/ (quarterly update).
const SOURCE_FILE = 'seoul-congestion-20260630.xlsx';
const SHEET_NAMES: Record<DayType, string> = {
  WEEKDAY: '평일',
  SATURDAY: '토요일',
  SUNDAY: '일요일',
};
const FIRST_RATE_COLUMN = 6;

async function readSheets(): Promise<Record<DayType, CongestionSheetRow[]>> {
  const workbook = new Workbook();
  await workbook.xlsx.readFile(join(RAW_DIR, SOURCE_FILE));

  const sheets = {} as Record<DayType, CongestionSheetRow[]>;
  for (const dayType of DAY_TYPES) {
    const sheet = workbook.getWorksheet(SHEET_NAMES[dayType]);
    if (!sheet) throw new Error(`sheet not found: ${SHEET_NAMES[dayType]}`);
    const rows: CongestionSheetRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rates: number[] = [];
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        rates.push(Number(row.getCell(FIRST_RATE_COLUMN + i).value));
      }
      rows.push({
        line: String(row.getCell(2).value),
        stationNo: Number(row.getCell(3).value),
        stationName: String(row.getCell(4).value),
        direction: String(row.getCell(5).value),
        rates,
      });
    });
    sheets[dayType] = rows;
  }
  return sheets;
}

async function main(): Promise<void> {
  const sheets = await readSheets();
  const { records, skipped } = buildCongestionRecords(sheets, loadStations());

  const output = {
    source:
      '서울교통공사_지하철혼잡도정보 (서울 열린데이터광장 OA-12928, 공공누리 3유형 출처표시 변경금지)',
    basedOn: '2026-06-30',
    note: '30분 단위 평균 혼잡도(%). 값은 원본 그대로이며 키만 우리 역 ID와 방향 코드로 바꿨다. 100이 정원이고 좌석 정원이 34%이다.',
    firstSlot: '05:30',
    slotMinutes: 30,
    slotCount: SLOT_COUNT,
    records,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'congestion.json'),
    JSON.stringify(output) + '\n',
  );

  const stationsCovered = new Set(records.map((r) => r.stationId)).size;
  console.log(
    `records: ${records.length}, stations covered: ${stationsCovered}, special-code rows skipped: ${skipped.specialCode}`,
  );
  console.log(`unmatched stations: ${skipped.unmatched.join(', ') || 'none'}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
