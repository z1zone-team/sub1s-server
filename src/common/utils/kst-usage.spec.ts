import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Guard: server time must go through common/utils/kst.ts. These calls depend on the server's time zone
// (or are UTC-only), which is how a UTC server ends up with month keys and day boundaries off by nine hours.
const FORBIDDEN: { pattern: RegExp; use: string }[] = [
  { pattern: /\.toISOString\(/, use: 'toKstIso() / kstNowIso()' },
  { pattern: /\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds)\(/, use: 'toKstDate() / kstDayKey() / kstMonthKey()' },
  { pattern: /\.getTimezoneOffset\(/, use: 'the KST helpers (the offset is fixed at +09:00)' },
  { pattern: /\.toLocale(Date|Time)?String\(/, use: 'toKstIso() or the KST helpers' },
  { pattern: /new Date\(\s*[\w.$]+\s*,/, use: 'kstMidnight() / kstStartOfMonth() / kstStartOfYear() (new Date(y, m, d) is server-local)' },
];

// kst.ts itself, specs (they assert on instants), and the offline CLI scripts are exempt.
const isExempt = (file: string): boolean =>
  file.endsWith('.spec.ts') ||
  file.endsWith('.e2e-spec.ts') ||
  file === join('common', 'utils', 'kst.ts') ||
  file.split(/[\\/]/)[0] === 'scripts';

export function findViolations(source: string): { line: number; text: string; use: string }[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, (match, lead: string) => lead + ' '.repeat(match.length - lead.length));

  const found: { line: number; text: string; use: string }[] = [];
  withoutComments.split('\n').forEach((text, index) => {
    for (const { pattern, use } of FORBIDDEN) {
      if (pattern.test(text)) found.push({ line: index + 1, text: text.trim(), use });
    }
  });
  return found;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('KST usage guard', () => {
  it('flags server-local and UTC-only time calls', () => {
    const flagged = (code: string) => findViolations(code).length;

    expect(flagged('const s = new Date().toISOString();')).toBe(1);
    expect(flagged('const m = now.getMonth() + 1;')).toBe(1);
    expect(flagged('const y = d.getFullYear();')).toBe(1);
    expect(flagged('const d = new Date(year, month - 1, 1);')).toBe(1);
    expect(flagged('const d = new Date(2026, 0, 1);')).toBe(1);
    expect(flagged('x.toLocaleDateString("ko-KR");')).toBe(1);
    expect(flagged('d.getTimezoneOffset();')).toBe(1);
  });

  it('allows the KST helpers and instant arithmetic', () => {
    const flagged = (code: string) => findViolations(code).length;

    expect(flagged('const s = kstNowIso();')).toBe(0);
    expect(flagged('const s = toKstIso(log.createdAt);')).toBe(0);
    expect(flagged('const t = new Date(Date.now() + 1000);')).toBe(0);
    expect(flagged('const t = new Date(departureDate.getTime() + 5);')).toBe(0);
    expect(flagged('const t = new Date(Date.UTC(y, m, d));')).toBe(0);
    expect(flagged('const t = new Date(value);')).toBe(0);
  });

  it('ignores mentions in comments', () => {
    expect(findViolations('// uses toISOString() internally\nconst a = 1;')).toHaveLength(0);
    expect(findViolations('/* new Date().getMonth() */ const a = 1;')).toHaveLength(0);
    expect(findViolations('const url = "https://x.test/a"; const a = 1;')).toHaveLength(0);
  });

  it('keeps every server source file on the KST helpers', () => {
    const srcDir = join(__dirname, '..', '..');
    const offenders = listSourceFiles(srcDir)
      .map((file) => relative(srcDir, file))
      .filter((file) => !isExempt(file))
      .flatMap((file) =>
        findViolations(readFileSync(join(srcDir, file), 'utf-8')).map(
          (v) => `${file}:${v.line}  ${v.text}  ->  use ${v.use}`,
        ),
      );

    expect(offenders).toEqual([]);
  });
});
