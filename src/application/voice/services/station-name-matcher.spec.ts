import {
  compactForMatching,
  jamoDistance,
  StationNameMatcher,
  toJamo,
} from './station-name-matcher';

const distance = (a: string, b: string): number =>
  jamoDistance(toJamo(a), toJamo(b));

describe('compactForMatching', () => {
  it('공백과 기호를 지운다', () => {
    expect(compactForMatching('광흥 창 역!')).toBe('광흥창역');
  });

  it('숫자는 한자어 읽기로 바꾼다', () => {
    expect(compactForMatching('1진로')).toBe('일진로');
    expect(compactForMatching('을지로4가')).toBe('을지로사가');
    expect(compactForMatching('3호선')).toBe('삼호선');
  });
});

describe('toJamo', () => {
  it('음절을 초성, 중성, 종성으로 나눈다', () => {
    expect(toJamo('각').map((j) => j.value)).toEqual(['ㄱ', 'ㅏ', 'ㄱ']);
    expect(toJamo('가').map((j) => j.value)).toEqual(['ㄱ', 'ㅏ']);
  });

  it('한글이 아닌 글자는 그대로 둔다', () => {
    expect(toJamo('A').map((j) => j.value)).toEqual(['a']);
  });
});

describe('jamoDistance', () => {
  it('같으면 0이다', () => {
    expect(distance('을지로입구', '을지로입구')).toBe(0);
  });

  it('받침이 붙거나 빠진 것은 싸게(0.7) 센다', () => {
    expect(distance('도봉사', '도봉산')).toBeCloseTo(0.7);
  });

  it('된소리와 거센소리 혼동은 반만(0.5) 틀린 것으로 센다', () => {
    expect(distance('까치', '가치')).toBeCloseTo(0.5);
    expect(distance('고세', '고쎄')).toBeCloseTo(0.5);
  });

  it('ㅐ와 ㅔ 혼동은 반만 틀린 것으로 센다', () => {
    expect(distance('고세', '고새')).toBeCloseTo(0.5);
  });

  it('다른 자모는 1이다', () => {
    expect(distance('중계', '중곡')).toBeGreaterThanOrEqual(1);
  });

  it('초성과 중성처럼 자리가 다른 자모는 같다고 보지 않는다', () => {
    expect(distance('ㅏ', '아')).toBeGreaterThan(0);
  });
});

describe('StationNameMatcher', () => {
  const matcher = new StationNameMatcher([
    '선정릉',
    '정릉',
    '선릉',
    '신정',
    '도봉산',
    '도봉',
    '홍제',
    '서초',
    '초당',
    '동두천중앙',
    '동두천',
    '중앙',
    '광흥창',
    '발곡',
    '화랑대',
    '석남',
    '성남',
    '중계',
    '을지로입구',
    '을지로4가',
    '강남',
    '사당',
    '고색',
  ]);

  describe('isExact', () => {
    it('이름이 그대로면(공백, 기호 무시) 그 이름을 돌려준다', () => {
      expect(matcher.isExact('광흥 창')).toBe('광흥창');
    });

    it('다르면 null이다', () => {
      expect(matcher.isExact('광흥촹')).toBeNull();
    });
  });

  describe('closestAtEnd', () => {
    it('정확히 일치하면 거리 0이다', () => {
      expect(matcher.closestAtEnd('강남')).toEqual({ name: '강남', distance: 0 });
    });

    it('이름 안의 공백은 무시한다', () => {
      expect(matcher.closestAtEnd('광흥 창')).toEqual({ name: '광흥창', distance: 0 });
    });

    it('앞쪽의 군더더기 말은 무시하고 끝의 이름을 찾는다', () => {
      expect(matcher.closestAtEnd('지금 강남')).toEqual({ name: '강남', distance: 0 });
    });

    it('받침을 잘못 들은 이름을 가장 가까운 역으로 보정한다', () => {
      expect(matcher.closestAtEnd('고세')?.name).toBe('고색');
    });

    it('숫자로 적힌 이름도 한자어 읽기로 비교한다 (1진로 입구 → 을지로입구)', () => {
      expect(matcher.closestAtEnd('1진로입구')?.name).toBe('을지로입구');
    });

    it('끝의 `역`이 `녁`으로 들린 것은 버리고 비교한다', () => {
      expect(matcher.closestAtEnd('도봉사녁')?.name).toBe('도봉산');
    });

    it('앞 글자의 받침이 이어져 `역`이 `격`으로 들린 것도 버리고 비교한다 (발곡역 → 발고격)', () => {
      expect(matcher.closestAtEnd('발고격')?.name).toBe('발곡');
    });

    it('`역`처럼 들리지 않는 끝 글자는 버리지 않는다', () => {
      // `능`을 버리면 `신정`이 가까워 보이지만 그건 `선정능`을 설명하지 못한다
      expect(matcher.closestAtEnd('선정능')?.name).toBe('선정릉');
    });

    it('더 긴 이름에 포함된 짧은 이름은 경쟁자로 세지 않는다 (선정릉 대 정릉)', () => {
      const result = matcher.closestAtEnd('선정능');

      expect(result?.name).toBe('선정릉');
    });

    it('가장 가까운 역이 둘 이상 비슷하면 보정하지 않는다 (섬남은 석남인지 성남인지 모른다)', () => {
      expect(matcher.closestAtEnd('섬남')).toBeNull();
    });

    it('너무 멀면 보정하지 않는다', () => {
      expect(matcher.closestAtEnd('엉뚱한말')).toBeNull();
    });

    it('이름이 정확히 일치하면 다른 역이 비슷해도 그 역이다', () => {
      // `성남`은 `석남`과 한 글자 차이지만 그대로 일치한다
      expect(matcher.closestAtEnd('성남')).toEqual({ name: '성남', distance: 0 });
    });

    it('빈 입력은 null이다', () => {
      expect(matcher.closestAtEnd('')).toBeNull();
      expect(matcher.closestAtEnd(' ! ')).toBeNull();
    });

    it('거리가 가까운 쪽이 앞선다', () => {
      expect(matcher.closestAtEnd('중개')).toMatchObject({ name: '중계' });
    });
  });
});
