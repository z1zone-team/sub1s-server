import { ConfigService } from '@nestjs/config';
import { PushMessage } from '../../domain/notification/models/push';
import { ExpoPushSender } from './expo-push.sender';

describe('ExpoPushSender', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const sender = (env: Record<string, string> = {}) =>
    new ExpoPushSender({ get: (name: string) => env[name] } as unknown as ConfigService);

  const message = (token: string, over: Partial<PushMessage> = {}): PushMessage => ({
    token,
    title: '9월 이동 정산',
    body: '45번 이동했어요',
    data: { type: 'MONTHLY_SETTLEMENT' },
    channelId: 'subway-settlement',
    ...over,
  });

  const respond = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts the messages to Expo with the channel and a high priority', async () => {
    respond({ data: [{ status: 'ok', id: 'a' }] });

    await sender().send([message('ExponentPushToken[a]')]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(init.body)).toEqual([
      {
        to: 'ExponentPushToken[a]',
        title: '9월 이동 정산',
        body: '45번 이동했어요',
        data: { type: 'MONTHLY_SETTLEMENT' },
        sound: 'default',
        priority: 'high',
        channelId: 'subway-settlement',
      },
    ]);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('adds the access token when it is configured', async () => {
    respond({ data: [{ status: 'ok' }] });

    await sender({ EXPO_ACCESS_TOKEN: 'secret' }).send([message('t')]);

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });

  it('maps each ticket to the message in the same order', async () => {
    respond({
      data: [
        { status: 'ok' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
      ],
    });

    const results = await sender().send([message('a'), message('b'), message('c')]);

    expect(results).toEqual([
      { token: 'a', ok: true, invalidToken: false },
      { token: 'b', ok: false, invalidToken: true },
      { token: 'c', ok: false, invalidToken: false },
    ]);
  });

  it('sends in batches of one hundred', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: JSON.parse(init.body).map(() => ({ status: 'ok' })) }),
    }));
    const messages = Array.from({ length: 250 }, (_, i) => message(`t${i}`));

    const results = await sender().send(messages);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(250);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('marks everything failed, without throwing, on an HTTP error, a network error, or a malformed response', async () => {
    respond({}, { ok: false, status: 500 });
    expect(await sender().send([message('a')])).toEqual([{ token: 'a', ok: false, invalidToken: false }]);

    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await sender().send([message('a')])).toEqual([{ token: 'a', ok: false, invalidToken: false }]);

    respond({ data: [] });
    expect(await sender().send([message('a')])).toEqual([{ token: 'a', ok: false, invalidToken: false }]);
  });

  it('does not call Expo for no messages', async () => {
    expect(await sender().send([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the credentials out of the logs', async () => {
    fetchMock.mockRejectedValue(new Error('failed for Bearer secret'));
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();

    await sender({ EXPO_ACCESS_TOKEN: 'secret' }).send([message('a')]);

    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });
});
