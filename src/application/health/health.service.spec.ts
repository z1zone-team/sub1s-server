import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let queryRaw: jest.Mock;

  const service = (aiUrl?: string) =>
    new HealthService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      {
        get: (name: string) => (name === 'AI_SERVICE_URL' ? aiUrl : undefined),
      } as unknown as ConfigService,
    );

  const respond = (body: unknown, init: { ok?: boolean } = {}) =>
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      json: async () => body,
    });

  beforeEach(() => {
    queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('AI 서비스 주소가 없으면 호출하지 않고 not_configured다', async () => {
    expect(await service(undefined).check()).toEqual({
      status: 'ok',
      database: 'up',
      ai: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI 서비스가 정상이면 up과 모델 이름을 돌려준다', async () => {
    respond({ status: 'ok', service: 'sub1s-ai', whisper_model: 'small-int8' });

    const result = await service('http://ai:8000').check();

    expect(result).toEqual({
      status: 'ok',
      database: 'up',
      ai: 'up',
      whisperModel: 'small-int8',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://ai:8000/health', {
      signal: expect.any(AbortSignal),
    });
  });

  it('주소 끝의 슬래시는 정리해서 부른다', async () => {
    respond({ status: 'ok' });

    await service('http://ai:8000/').check();

    expect(String(fetchMock.mock.calls[0][0])).toBe('http://ai:8000/health');
  });

  it('모델 이름이 없으면 whisperModel은 생략한다', async () => {
    respond({ status: 'ok' });

    const result = await service('http://ai:8000').check();

    expect(result).toEqual({ status: 'ok', database: 'up', ai: 'up' });
  });

  it('AI 서비스가 오류 상태를 알리면 down이다', async () => {
    respond({ status: 'starting' });
    expect((await service('http://ai:8000').check()).ai).toBe('down');

    respond({}, { ok: false });
    expect((await service('http://ai:8000').check()).ai).toBe('down');
  });

  it('호출이 실패하거나 시간이 초과되면 down이지만 서버 상태는 ok다', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    const result = await service('http://ai:8000').check();

    expect(result.status).toBe('ok');
    expect(result.ai).toBe('down');
  });

  it('응답이 JSON이 아니어도 깨지지 않고 down이다', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });

    expect((await service('http://ai:8000').check()).ai).toBe('down');
  });

  it('DB에 연결할 수 없으면 AI 상태와 상관없이 503이다', async () => {
    queryRaw.mockRejectedValue(new Error('down'));
    respond({ status: 'ok' });

    await expect(service('http://ai:8000').check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
