import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { AiServiceAdapter } from './ai-service.adapter';

const adapterWith = (aiServiceUrl?: string) =>
  new AiServiceAdapter({
    get: () => aiServiceUrl,
  } as unknown as ConfigService);

const audioBody = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });

describe('AiServiceAdapter.openTtsStream', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const expectUnavailable = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toBeInstanceOf(BusinessException);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'AI_SERVICE_UNAVAILABLE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  };

  it('AI 서비스의 TTS 스트림 주소로 문장을 인코딩해 요청한다', async () => {
    fetchMock.mockResolvedValue(
      new Response(audioBody(), { headers: { 'content-type': 'audio/mpeg' } }),
    );

    const result = await adapterWith('http://ai:8000').openTtsStream(
      '강남역 & 을지로입구역?',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://ai:8000/api/v1/ai/tts/stream?text=${encodeURIComponent('강남역 & 을지로입구역?')}`,
    );
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.body).toBeDefined();
  });

  it('여러 조각으로 오는 오디오를 순서대로 모두 돌려준다', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3]));
            controller.enqueue(new Uint8Array([4, 5]));
            controller.close();
          },
        }),
      ),
    );

    const { body } = await adapterWith('http://ai:8000').openTtsStream('안내');
    const bytes: number[] = [];
    const reader = body.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes.push(...next.value);
    }

    expect(bytes).toEqual([1, 2, 3, 4, 5]);
  });

  it('응답에 content-type이 없으면 audio/mpeg로 본다', async () => {
    fetchMock.mockResolvedValue(new Response(audioBody()));

    const result = await adapterWith('http://ai:8000').openTtsStream('안내');

    expect(result.contentType).toContain('audio');
  });

  it('AI_SERVICE_URL이 없으면 호출하지 않고 503이다', async () => {
    await expectUnavailable(adapterWith(undefined).openTtsStream('안내'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI 서비스가 오류 상태를 돌려주면 503이다', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    await expectUnavailable(adapterWith('http://ai:8000').openTtsStream('안내'));
  });

  it('응답 본문이 없으면 503이다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expectUnavailable(adapterWith('http://ai:8000').openTtsStream('안내'));
  });

  it('200이지만 오디오가 비어 있으면 503이다 (합성 실패)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
      ),
    );

    await expectUnavailable(adapterWith('http://ai:8000').openTtsStream('안내'));
  });

  it('200 뒤 첫 조각을 읽다가 끊기면 503이다', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new TypeError('terminated'));
          },
        }),
      ),
    );

    await expectUnavailable(adapterWith('http://ai:8000').openTtsStream('안내'));
  });

  it('AI 서비스에 연결하지 못하면 503이다', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expectUnavailable(adapterWith('http://ai:8000').openTtsStream('안내'));
  });
});

describe('AiServiceAdapter.generateBriefing', () => {
  const route = {
    totalDurationSec: 4740,
    transferCount: 3,
  } as unknown as Parameters<AiServiceAdapter['generateBriefing']>[1];
  const briefing = (originStationName: string, destStationName = '강남') =>
    adapterWith(undefined).generateBriefing(
      { originStationName, destStationName, preferredMode: 'OPTIMAL' },
      route,
    );

  it('역 이름으로 출발하면 두 이름 뒤에 역을 붙인다', async () => {
    const result = await briefing('홍제', '광흥창');

    expect(result.briefingText).toBe(
      '홍제역에서 광흥창역까지 최적 경로로 안내해 드릴게요. 총 약 79분 소요되며 환승은 3회입니다. 안전한 이동 되세요.',
    );
  });

  it('현재 위치에서 출발하면 현재 위치에는 역을 붙이지 않는다', async () => {
    const result = await briefing('현재 위치');

    expect(result.briefingText).toMatch(/^현재 위치에서 강남역까지 최적 경로로/);
    expect(result.briefingText).not.toContain('현재 위치역');
  });

  it('음성 안내 주소(audioTtsUrl)에도 같은 문장이 들어간다', async () => {
    const result = await briefing('현재 위치');

    expect(decodeURIComponent(result.audioTtsUrl ?? '')).toContain('현재 위치에서 강남역까지');
  });
});
