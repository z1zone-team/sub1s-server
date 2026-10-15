import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { TrackingModule } from './tracking.module';

describe('TrackingModule', () => {
  // TravelLogService는 이 저장소를 @Optional()로 받는다. 내보내지 않으면 오류 없이 undefined가 되어
  // 안내 세션을 찾지 못하고 선택 스냅샷·경로 모드·정시 도착 기록이 모두 빠진다.
  it('주행 세션 저장소를 다른 모듈에 내보낸다', () => {
    const exported: unknown[] = Reflect.getMetadata('exports', TrackingModule);
    expect(exported).toContain(TRACKING_REPOSITORY);
  });
});
