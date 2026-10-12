import { HttpException, HttpStatus } from '@nestjs/common';
import { ValkeyService } from '../../../infra/queue/valkey.service';
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

  describe('Valkey를 쓸 수 있을 때', () => {
    const makeValkey = (overrides: Record<string, unknown> = {}) => ({
      enabled: true,
      setIfAbsent: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('SET NX EX로 사용자별 키를 만든다', async () => {
      const valkey = makeValkey();
      const locked = new VoiceLockService(valkey as unknown as ValkeyService);

      await expect(locked.acquireLock('user-1', 5)).resolves.toBe(true);

      expect(valkey.setIfAbsent).toHaveBeenCalledWith('lock:voice:user-1', 5);
    });

    it('다른 서버가 이미 잡고 있으면 메모리로 되돌아가지 않고 false이다', async () => {
      const valkey = makeValkey({
        setIfAbsent: jest.fn().mockResolvedValue(false),
      });
      const locked = new VoiceLockService(valkey as unknown as ValkeyService);

      await expect(locked.acquireLock('user-1', 5)).resolves.toBe(false);
      await expect(locked.assertLock('user-1', 5)).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('Valkey 오류가 나면 서버 메모리 락으로 대체한다', async () => {
      const valkey = makeValkey({
        setIfAbsent: jest.fn().mockRejectedValue(new Error('connection closed')),
      });
      const locked = new VoiceLockService(valkey as unknown as ValkeyService);

      await expect(locked.acquireLock('user-1', 5)).resolves.toBe(true);
      await expect(locked.acquireLock('user-1', 5)).resolves.toBe(false);
    });

    it('해제하면 Valkey 키도 지운다', async () => {
      const valkey = makeValkey();
      const locked = new VoiceLockService(valkey as unknown as ValkeyService);
      await locked.acquireLock('user-1', 5);

      await locked.releaseLock('user-1');

      expect(valkey.delete).toHaveBeenCalledWith('lock:voice:user-1');
    });

    it('clear는 이 서비스가 만든 Valkey 키만 지운다', async () => {
      const valkey = makeValkey();
      const locked = new VoiceLockService(valkey as unknown as ValkeyService);
      await locked.acquireLock('user-1', 5);
      await locked.acquireLock('user-2', 5);

      await locked.clear();

      expect(valkey.delete).toHaveBeenCalledTimes(2);
      expect(valkey.delete).toHaveBeenCalledWith('lock:voice:user-1');
      expect(valkey.delete).toHaveBeenCalledWith('lock:voice:user-2');
    });

    it('Valkey가 꺼져 있으면(enabled false) 건드리지 않고 메모리만 쓴다', async () => {
      const valkey = makeValkey({ enabled: false });
      const locked = new VoiceLockService(valkey as unknown as ValkeyService);

      await expect(locked.acquireLock('user-1', 5)).resolves.toBe(true);

      expect(valkey.setIfAbsent).not.toHaveBeenCalled();
    });
  });
});
