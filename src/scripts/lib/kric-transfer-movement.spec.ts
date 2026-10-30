import {
  SAMPLE_REQUEST,
  cacheFileName,
  parseArgs,
  requestsFromArgs,
  resultCodeOf,
  summarizeTransferMovement,
  validateRequest,
} from './kric-transfer-movement';

const row = (
  pathId: number,
  order: number,
  text: string,
  from = '3호선 을지로3가 방면',
) => ({
  mvPathMgNo: pathId,
  chtnMvTpOrdr: order,
  mvContDtl: text,
  stMovePath: from,
  edMovePath: '4호선 명동 방면',
  imgPath: `http://example.test/${pathId}.png`,
  elvtTpCd: null,
  elvtSttCd: null,
});

describe('cacheFileName', () => {
  it('샘플 요청은 이미 저장된 파일 이름과 같다', () => {
    expect(cacheFileName(SAMPLE_REQUEST)).toBe('S1_3_321_422_4_424.json');
  });
});

describe('validateRequest', () => {
  it('변수 6개가 모두 있으면 통과한다', () => {
    expect(validateRequest(SAMPLE_REQUEST)).toEqual([]);
  });

  it('빠졌거나 허용하지 않는 문자가 있으면 문제를 알려 준다', () => {
    expect(
      validateRequest({ ...SAMPLE_REQUEST, prevStinCd: '', lnCd: '3/4' }),
    ).toHaveLength(2);
    expect(validateRequest(null)).toHaveLength(1);
  });
});

describe('parseArgs and requestsFromArgs', () => {
  it('--sample은 샘플 한 건이다', () => {
    const args = parseArgs(['--sample', '--dry-run']);
    expect(args.dryRun).toBe(true);
    expect(requestsFromArgs(args)).toEqual([SAMPLE_REQUEST]);
  });

  it('단건은 변수 6개를 모두 줘야 한다', () => {
    const full = parseArgs([
      '--opr=S1',
      '--ln=3',
      '--stin=321',
      '--prev=422',
      '--target=4',
      '--next=424',
    ]);
    expect(requestsFromArgs(full)).toEqual([SAMPLE_REQUEST]);
    const partial = parseArgs(['--opr=S1', '--ln=3']);
    expect(() => requestsFromArgs(partial)).toThrow('요청 1');
  });

  it('입력 방식은 하나만 허용한다', () => {
    expect(() => requestsFromArgs(parseArgs([]))).toThrow('하나만');
    expect(() =>
      requestsFromArgs(parseArgs(['--sample', '--file=requests.json'])),
    ).toThrow('하나만');
  });

  it('--file 요청 배열을 검증한다', () => {
    const args = parseArgs(['--file=requests.json']);
    expect(requestsFromArgs(args, [SAMPLE_REQUEST])).toEqual([SAMPLE_REQUEST]);
    expect(() =>
      requestsFromArgs(args, [{ ...SAMPLE_REQUEST, stinCd: '' }]),
    ).toThrow('stinCd');
  });

  it('알 수 없는 인자는 거절한다', () => {
    expect(() => parseArgs(['--unknown=1'])).toThrow('알 수 없는 인자');
  });
});

describe('summarizeTransferMovement', () => {
  it('방향 조합별로 단계를 묶고 순서대로 정렬하며 층과 엘리베이터 언급을 읽는다', () => {
    const json = {
      header: { resultCode: '00' },
      body: [
        row(2, 2, '2) 4호선 명동 방면 엘리베이터 탑승'),
        row(2, 1, '1) (B4) 3호선 을지로3가 방면 승강장 하차'),
        row(
          4,
          1,
          '1) (B4) 3호선 동대입구 방면 승강장 하차',
          '3호선 동대입구 방면',
        ),
        row(4, 2, '2) 걸어서 이동'),
      ],
    };
    const paths = summarizeTransferMovement(json);
    expect(paths.map((path) => path.pathId)).toEqual([2, 4]);
    expect(paths[0].steps.map((step) => step.order)).toEqual([1, 2]);
    expect(paths[0].steps[0].floor).toBe('B4');
    expect(paths[0].steps[1].floor).toBeUndefined();
    expect(paths[0].mentionsElevator).toBe(true);
    expect(paths[1].mentionsElevator).toBe(false);
    expect(paths[0].from).toBe('3호선 을지로3가 방면');
    expect(paths[0].imagePath).toBe('http://example.test/2.png');
  });

  it('데이터가 없으면(03) 빈 배열이다', () => {
    const json = {
      header: { resultCode: '03', resultMsg: '데이터가 없습니다.' },
    };
    expect(summarizeTransferMovement(json)).toEqual([]);
    expect(resultCodeOf(json)).toBe('03');
    expect(resultCodeOf(null)).toBeUndefined();
  });
});
