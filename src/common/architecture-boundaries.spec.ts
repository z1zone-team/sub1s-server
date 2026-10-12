import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// 가드: 도메인 계층(`domain/`)은 인프라(`infra/`)와 애플리케이션(`application/`)을 import하지 않는다.
// 의존은 application, infra가 domain의 포트를 향해야 하고 반대로 가면 구현을 바꾸거나 테스트할 때
// 구체 모듈이 따라온다 (docs/ARCHITECTURE_DESIGN.md 3.4, 서버 아키텍처 점검 1번)

// 아직 고치지 못한 기존 위반. 새로 늘리지 않고 고칠 때 이 목록에서 지운다
const KNOWN_VIOLATIONS = new Set<string>([
  // 주행 세션 모델이 경로 응답 DTO를 그대로 쓴다. DTO를 도메인 모델로 옮겨야 한다
  join('domain', 'tracking', 'models', 'tracking-session.ts'),
]);

const FORBIDDEN_IMPORT = /from\s+['"](?:\.\.\/)+(infra|application)\//;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

export function findBoundaryViolations(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('//') && !line.startsWith('*'))
    .filter((line) => FORBIDDEN_IMPORT.test(line));
}

describe('architecture boundaries', () => {
  const srcRoot = join(__dirname, '..');

  it('domain 계층은 infra와 application을 import하지 않는다', () => {
    const offenders = listSourceFiles(join(srcRoot, 'domain'))
      .map((file) => relative(srcRoot, file))
      .filter((file) => !KNOWN_VIOLATIONS.has(file))
      .filter((file) =>
        findBoundaryViolations(readFileSync(join(srcRoot, file), 'utf-8')).length > 0,
      );

    expect(offenders).toEqual([]);
  });

  it('알려진 위반 목록에는 아직 위반하는 파일만 남긴다', () => {
    const stale = [...KNOWN_VIOLATIONS].filter(
      (file) =>
        findBoundaryViolations(readFileSync(join(srcRoot, file), 'utf-8')).length === 0,
    );

    expect(stale).toEqual([]);
  });

  describe('findBoundaryViolations', () => {
    it('infra와 application을 가리키는 상대 경로 import를 찾는다', () => {
      expect(
        findBoundaryViolations("import { A } from '../../infra/database/x';"),
      ).toHaveLength(1);
      expect(
        findBoundaryViolations('import { B } from "../../../application/route/dto/y";'),
      ).toHaveLength(1);
    });

    it('domain 안의 import와 주석은 위반으로 보지 않는다', () => {
      expect(findBoundaryViolations("import { A } from '../ports/IUserRepository';")).toEqual([]);
      expect(findBoundaryViolations("// import { A } from '../../infra/x';")).toEqual([]);
      expect(findBoundaryViolations(" * from '../../application/x'")).toEqual([]);
    });
  });
});
