/**
 * 음성 전사가 역 이름을 잘못 알아들었을 때 가장 가까운 역을 찾는다.
 * 한글을 자모로 나눠 편집 거리를 재고(받침이 있고 없고, 된소리와 거센소리, ㅐ와 ㅔ 같은 흔한 혼동은 싸게 친다),
 * 숫자는 한자어 읽기로 바꿔 비교한다(`1진로` → `일진로`). 오탐을 줄이려고 다음 규칙을 둔다.
 * - 거리가 이름 길이의 25%(최대 3)를 넘으면 보정하지 않는다
 * - 가장 가까운 역이 둘 이상 비슷하면(차이가 0.5 미만) 보정하지 않는다
 */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
];

const SINO_DIGITS = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

/** 자주 혼동하는 자모 묶음. 같은 묶음 안에서 바뀐 것은 반만 틀린 것으로 센다 */
const CONFUSABLE_GROUPS = [
  ['ㄱ', 'ㅋ', 'ㄲ'],
  ['ㄷ', 'ㅌ', 'ㄸ'],
  ['ㅂ', 'ㅍ', 'ㅃ'],
  ['ㅈ', 'ㅊ', 'ㅉ'],
  ['ㅅ', 'ㅆ'],
  ['ㅐ', 'ㅔ'],
  ['ㅒ', 'ㅖ'],
  ['ㅙ', 'ㅞ', 'ㅚ'],
];
const CONFUSABLE = new Map<string, number>();
CONFUSABLE_GROUPS.forEach((group, index) =>
  group.forEach((jamo) => CONFUSABLE.set(jamo, index)),
);

/** 자모 하나. `kind`로 초성, 중성, 종성을 구분해서 서로 다른 자리의 자모는 같지 않게 본다 */
interface Jamo {
  kind: 'c' | 'v' | 'f';
  value: string;
}

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 비교에 쓸 글자만 남긴다: 공백과 기호를 지우고 숫자를 한자어 읽기로 바꾼다 */
export function compactForMatching(text: string): string {
  return text
    .replace(/[0-9]/g, (digit) => SINO_DIGITS[Number(digit)])
    .replace(/[^가-힣a-zA-Z]/g, '');
}

export function toJamo(text: string): Jamo[] {
  const result: Jamo[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code >= HANGUL_START && code <= HANGUL_END) {
      const offset = code - HANGUL_START;
      const jong = offset % 28;
      const jung = Math.floor(offset / 28) % 21;
      const cho = Math.floor(offset / 28 / 21);
      result.push({ kind: 'c', value: CHO[cho] });
      result.push({ kind: 'v', value: JUNG[jung] });
      if (jong > 0) result.push({ kind: 'f', value: JONG[jong] });
    } else {
      result.push({ kind: 'c', value: char.toLowerCase() });
    }
  }
  return result;
}

/**
 * `역`처럼 들리는 글자인지: 모음이 `ㅕ`나 `ㅓ`이고 받침이 없거나 `ㄱ ㄴ ㅇ ㄹ`이다(역, 녁, 력, 억, 연, 영, 열 ...).
 * 앞 글자의 받침이 이어져 소리 나면(`곡` + `역` → `고격`) `격`처럼 첫 소리가 바뀐 것도 포함한다
 */
function soundsLikeYeok(syllable: string | undefined): boolean {
  if (!syllable) return false;
  const [, vowel, final] = toJamo(syllable);
  if (!vowel || (vowel.value !== 'ㅕ' && vowel.value !== 'ㅓ')) return false;
  return !final || ['ㄱ', 'ㄴ', 'ㅇ', 'ㄹ'].includes(final.value);
}

const INDEL_FINAL = 0.7; // 받침이 붙거나 빠지는 것은 흔한 오인식이라 싸게 친다
const INDEL = 1;
const CONFUSABLE_COST = 0.5;

function substitutionCost(a: Jamo, b: Jamo): number {
  if (a.kind !== b.kind) return INDEL * 2;
  if (a.value === b.value) return 0;
  const groupA = CONFUSABLE.get(a.value);
  if (groupA !== undefined && groupA === CONFUSABLE.get(b.value)) {
    return CONFUSABLE_COST;
  }
  return 1;
}

const indelCost = (jamo: Jamo): number =>
  jamo.kind === 'f' ? INDEL_FINAL : INDEL;

/** 자모 단위 가중 편집 거리 */
export function jamoDistance(a: readonly Jamo[], b: readonly Jamo[]): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array<number>(cols);
  previous[0] = 0;
  for (let j = 1; j < cols; j++) previous[j] = previous[j - 1] + indelCost(b[j - 1]);

  for (let i = 1; i < rows; i++) {
    const current = new Array<number>(cols);
    current[0] = previous[0] + indelCost(a[i - 1]);
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(
        previous[j] + indelCost(a[i - 1]),
        current[j - 1] + indelCost(b[j - 1]),
        previous[j - 1] + substitutionCost(a[i - 1], b[j - 1]),
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

export interface StationMatch {
  name: string;
  distance: number;
}

interface Entry {
  name: string;
  compact: string;
  jamo: Jamo[];
  threshold: number;
}

/** 이름 길이(자모 수)의 25%, 최대 3 */
const maxDistanceFor = (jamoLength: number): number =>
  Math.min(3, jamoLength * 0.25);
/** 가장 가까운 역과 두 번째로 가까운 역의 거리 차이가 이만큼은 나야 하나로 정한다 */
const MIN_MARGIN = 0.5;

export class StationNameMatcher {
  private readonly entries: Entry[];

  /** @param names 역 이름(끝의 `역`을 뗀 것) */
  constructor(names: Iterable<string>) {
    this.entries = [...new Set(names)]
      .map((name) => {
        const compact = compactForMatching(name);
        const jamo = toJamo(compact);
        return { name, compact, jamo, threshold: maxDistanceFor(jamo.length) };
      })
      .filter((entry) => entry.compact.length >= 2);
  }

  /** 이 이름이 역 이름 그대로인지(공백과 기호는 무시) */
  isExact(candidate: string): string | null {
    const compact = compactForMatching(candidate);
    return this.entries.find((entry) => entry.compact === compact)?.name ?? null;
  }

  /**
   * 구간 끝에 오는 역 이름을 찾는다. "X역에서"나 "Y역까지"처럼 표지 바로 앞에 이름이 오므로
   * 구간의 **끝**에서 이름 길이만큼 잘라 비교한다(앞쪽의 군더더기 말은 무시).
   * 끝의 `역`이 `녁`, `력`처럼 틀리게 들릴 수 있어, 끝 글자가 `역`과 비슷한 소리일 때만 그 글자를 버린 것도 비교한다.
   */
  closestAtEnd(region: string): StationMatch | null {
    const compact = compactForMatching(region);
    if (compact.length < 1) return null;

    const maxDrop = soundsLikeYeok(compact[compact.length - 1]) ? 1 : 0;
    const scored: StationMatch[] = [];
    for (const entry of this.entries) {
      let best = Infinity;
      const length = entry.compact.length;
      for (let drop = 0; drop <= maxDrop; drop++) {
        const end = compact.length - drop;
        if (end < 1) continue;
        for (let size = Math.max(1, length - 1); size <= length + 1; size++) {
          const start = end - size;
          if (start < 0) continue;
          const distance = jamoDistance(toJamo(compact.slice(start, end)), entry.jamo);
          // 끝의 한 글자를 버린 경우는 그만큼 조금 더 의심스러우니 가산한다
          best = Math.min(best, distance + drop * 0.25);
        }
      }
      if (best <= entry.threshold) scored.push({ name: entry.name, distance: best });
    }
    if (scored.length === 0) return null;

    scored.sort((x, y) => x.distance - y.distance || y.name.length - x.name.length);
    // 이름이 그대로 일치하면 다른 역이 비슷해도 그 역이다
    if (scored[0].distance === 0) return scored[0];

    // 더 긴 이름 안에 들어 있는 짧은 이름은 따로 센 후보가 아니라 그 긴 이름의 일부로 본다.
    // 예: `선정능`은 `선정릉`과 거리 1이고 `정릉`도 끝부분이 거리 1인데, `정릉`은 `선정릉`에 포함되므로 경쟁자가 아니다
    const candidates = scored.filter(
      (candidate) =>
        !scored.some(
          (other) =>
            other !== candidate &&
            other.name.length > candidate.name.length &&
            other.name.includes(candidate.name) &&
            other.distance <= candidate.distance + MIN_MARGIN,
        ),
    );
    const [first, second] = candidates;
    if (second && second.distance - first.distance < MIN_MARGIN) return null;
    return first;
  }
}
