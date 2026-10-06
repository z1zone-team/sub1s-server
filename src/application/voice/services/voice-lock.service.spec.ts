import { HttpException, HttpStatus } from '@nestjs/common';
import { VoiceLockService } from './voice-lock.service';

describe('VoiceLockService', () => {
  let service: VoiceLockService;

  beforeEach(() => {
    service = new VoiceLockService();
  });

  it('should acquire lock for the first time', async () => {
    const acquired = await service.acquireLock('user-1', 5);
    expect(acquired).toBe(true);
  });

  it('should fail to acquire lock if already held within ttl', async () => {
    await service.acquireLock('user-1', 5);
    const secondTry = await service.acquireLock('user-1', 5);
    expect(secondTry).toBe(false);
  });

  it('should throw TOO_MANY_REQUESTS on assertLock when locked', async () => {
    await service.assertLock('user-1', 5);

    await expect(service.assertLock('user-1', 5)).rejects.toThrow(
      new HttpException(
        '이전 음성 요청을 처리 중입니다. 잠시만 기다려주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('should re-acquire lock after release', async () => {
    await service.acquireLock('user-1', 5);
    await service.releaseLock('user-1');

    const reacquired = await service.acquireLock('user-1', 5);
    expect(reacquired).toBe(true);
  });

  it('should isolate locks by userId', async () => {
    await service.acquireLock('user-1', 5);
    const user2Acquired = await service.acquireLock('user-2', 5);
    expect(user2Acquired).toBe(true);
  });
});
