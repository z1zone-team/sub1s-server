import { extractKricBody } from './kric-convenience';

export interface TransferMovementRequest {
  railOprIsttCd: string;
  lnCd: string;
  stinCd: string;
  prevStinCd: string;
  chthTgtLn: string;
  chtnNextStinCd: string;
}

export interface TransferMovementStep {
  order: number;
  text: string;
  floor?: string;
}

export interface TransferMovementPath {
  pathId: number;
  from: string;
  to: string;
  steps: TransferMovementStep[];
  mentionsElevator: boolean;
  imagePath?: string;
}

export interface TransferMovementArgs {
  sample: boolean;
  file?: string;
  single: Partial<TransferMovementRequest>;
  force: boolean;
  dryRun: boolean;
}

// 포털 상세 화면의 샘플(충무로역, 3호선에서 4호선 환승)
export const SAMPLE_REQUEST: TransferMovementRequest = {
  railOprIsttCd: 'S1',
  lnCd: '3',
  stinCd: '321',
  prevStinCd: '422',
  chthTgtLn: '4',
  chtnNextStinCd: '424',
};

const FIELDS: (keyof TransferMovementRequest)[] = [
  'railOprIsttCd',
  'lnCd',
  'stinCd',
  'prevStinCd',
  'chthTgtLn',
  'chtnNextStinCd',
];

const FLAG_TO_FIELD: Record<string, keyof TransferMovementRequest> = {
  '--opr': 'railOprIsttCd',
  '--ln': 'lnCd',
  '--stin': 'stinCd',
  '--prev': 'prevStinCd',
  '--target': 'chthTgtLn',
  '--next': 'chtnNextStinCd',
};

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateRequest(request: unknown): string[] {
  if (!request || typeof request !== 'object') return ['요청이 객체가 아니다'];
  const values = request as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of FIELDS) {
    const value = values[field];
    if (typeof value !== 'string' || !CODE_PATTERN.test(value)) {
      problems.push(`${field} 값이 없거나 영문, 숫자, _, -가 아니다`);
    }
  }
  return problems;
}

export function cacheFileName(request: TransferMovementRequest): string {
  return `${FIELDS.map((field) => request[field]).join('_')}.json`;
}

export function parseArgs(argv: readonly string[]): TransferMovementArgs {
  const args: TransferMovementArgs = {
    sample: false,
    single: {},
    force: false,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === '--sample') args.sample = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
    else {
      const [flag, ...rest] = arg.split('=');
      const field = FLAG_TO_FIELD[flag];
      if (!field) throw new Error(`알 수 없는 인자: ${flag}`);
      args.single[field] = rest.join('=');
    }
  }
  return args;
}

/** 입력 방식은 하나만 쓴다. 단건은 변수 6개를 모두 줘야 한다 */
export function requestsFromArgs(
  args: TransferMovementArgs,
  fileRequests: readonly unknown[] = [],
): TransferMovementRequest[] {
  const singleCount = Object.keys(args.single).length;
  const modes = [args.sample, singleCount > 0, args.file !== undefined].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    throw new Error('--sample, 단건 변수 6개, --file 중 하나만 지정해야 한다');
  }
  let requests: unknown[];
  if (args.sample) requests = [SAMPLE_REQUEST];
  else if (args.file !== undefined) requests = [...fileRequests];
  else requests = [args.single];

  requests.forEach((request, index) => {
    const problems = validateRequest(request);
    if (problems.length > 0) {
      throw new Error(`요청 ${index + 1}: ${problems.join(', ')}`);
    }
  });
  return requests as TransferMovementRequest[];
}

interface TransferMovementRow {
  mvPathMgNo?: number;
  chtnMvTpOrdr?: number;
  mvContDtl?: string;
  stMovePath?: string;
  edMovePath?: string;
  imgPath?: string;
}

/** 환승 방향 조합(mvPathMgNo)별로 단계를 묶는다. 층은 단계 글의 `(B4)` 같은 표기에서 읽는다 */
export function summarizeTransferMovement(
  json: unknown,
): TransferMovementPath[] {
  const paths = new Map<number, TransferMovementPath>();
  for (const row of extractKricBody<TransferMovementRow>(json)) {
    if (typeof row.mvPathMgNo !== 'number' || !row.mvContDtl) continue;
    let path = paths.get(row.mvPathMgNo);
    if (!path) {
      path = {
        pathId: row.mvPathMgNo,
        from: row.stMovePath ?? '',
        to: row.edMovePath ?? '',
        steps: [],
        mentionsElevator: false,
        ...(row.imgPath ? { imagePath: row.imgPath } : {}),
      };
      paths.set(row.mvPathMgNo, path);
    }
    const floor = /\((B?\d+)\)/.exec(row.mvContDtl)?.[1];
    path.steps.push({
      order: row.chtnMvTpOrdr ?? path.steps.length + 1,
      text: row.mvContDtl,
      ...(floor ? { floor } : {}),
    });
    if (row.mvContDtl.includes('엘리베이터')) path.mentionsElevator = true;
  }
  return [...paths.values()]
    .map((path) => ({
      ...path,
      steps: [...path.steps].sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => a.pathId - b.pathId);
}

export function resultCodeOf(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const header = (json as { header?: { resultCode?: unknown } }).header;
  return typeof header?.resultCode === 'string' ? header.resultCode : undefined;
}
