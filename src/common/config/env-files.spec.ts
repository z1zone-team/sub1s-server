import { ENV_FILE_PATHS } from './env-files';

describe('ENV_FILE_PATHS', () => {
  it('.env.local을 .env보다 먼저 읽는다 (앞의 파일이 우선)', () => {
    expect(ENV_FILE_PATHS.indexOf('.env.local')).toBeGreaterThanOrEqual(0);
    expect(ENV_FILE_PATHS.indexOf('.env.local')).toBeLessThan(
      ENV_FILE_PATHS.indexOf('.env'),
    );
  });

  it('.env.prod는 자동으로 읽지 않는다', () => {
    expect(ENV_FILE_PATHS).not.toContain('.env.prod');
  });
});
