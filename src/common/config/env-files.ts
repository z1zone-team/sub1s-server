/**
 * 환경 변수 파일 로드 순서. 앞의 파일이 우선하고(Nest `ConfigModule`의 `envFilePath` 규칙),
 * 이미 설정된 프로세스 환경 변수는 파일보다 우선한다. `.env.prod`는 자동으로 읽지 않는다
 * (운영 값은 배포 환경에서 환경 변수로 주입한다)
 */
export const ENV_FILE_PATHS: readonly string[] = ['.env.local', '.env'];
