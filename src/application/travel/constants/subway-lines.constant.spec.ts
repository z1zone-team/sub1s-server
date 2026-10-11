import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUBWAY_LINES_META, getLineMetadata } from './subway-lines.constant';

const dataDir = resolve(__dirname, '../../../data/subway');
const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));

describe('SUBWAY_LINES_META', () => {
  const lines = read<{ id: string; lineName: string }[]>('lines.json');
  const stations = read<{ lineId: string }[]>('stations.json');

  it('has an entry for every line in lines.json', () => {
    const missing = lines.filter((line) => !SUBWAY_LINES_META[line.id]).map((line) => line.id);

    expect(missing).toEqual([]);
  });

  it('has an entry for every line id a station uses, so no line falls back to the gray default', () => {
    const used = [...new Set(stations.map((station) => station.lineId))];
    const fallback = used.filter((lineId) => getLineMetadata(lineId).colorHex === '#888888');

    expect(fallback).toEqual([]);
  });

  it('keeps no key that is not a real line id', () => {
    const known = new Set(lines.map((line) => line.id));

    expect(Object.keys(SUBWAY_LINES_META).filter((key) => !known.has(key))).toEqual([]);
  });

  it('uses the same line names as lines.json, which seeds the database', () => {
    for (const line of lines) {
      expect(SUBWAY_LINES_META[line.id].lineName).toBe(line.lineName);
    }
  });

  it('gives every line a distinct-looking hex color', () => {
    for (const meta of Object.values(SUBWAY_LINES_META)) {
      expect(meta.colorHex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('resolves the lines that used to be wrong', () => {
    expect(getLineMetadata('SD')).toEqual({ lineName: '수인분당선', colorHex: '#FABE00' });
    expect(getLineMetadata('GG')).toEqual({ lineName: '경강선', colorHex: '#0054A6' });
    expect(getLineMetadata('GA')).toEqual({ lineName: 'GTX-A', colorHex: '#9A6292' });
    expect(getLineMetadata('EV').lineName).toBe('에버라인');
    expect(getLineMetadata('I2').lineName).toBe('인천2호선');
  });

  it('still falls back for an unknown line id', () => {
    expect(getLineMetadata('ZZ')).toEqual({ lineName: 'ZZ호선', colorHex: '#888888' });
  });
});
