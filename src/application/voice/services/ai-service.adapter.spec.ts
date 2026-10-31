import { ConfigService } from '@nestjs/config';
import { AiServiceAdapter } from './ai-service.adapter';

const adapterWith = (aiServiceUrl?: string) =>
  new AiServiceAdapter({
    get: () => aiServiceUrl,
  } as unknown as ConfigService);

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

  it('이름을 넘기면 그 이름을 그대로 쓴다(장소 이름과 주소에는 역을 붙이지 않는다)', async () => {
    const result = await adapterWith(undefined).generateBriefing(
      {
        originStationName: '현재 위치',
        destStationName: '문화로 67-1',
        preferredMode: 'OPTIMAL',
      },
      route,
      { origin: '현재 위치', destination: '경기도 광주시 문화로 67-1' },
    );

    expect(result.briefingText).toMatch(
      /^현재 위치에서 경기도 광주시 문화로 67-1까지 최적 경로로/,
    );
    expect(result.briefingText).not.toContain('67-1역');
  });

  it('현재 위치에서 출발하면 현재 위치에는 역을 붙이지 않는다', async () => {
    const result = await briefing('현재 위치');

    expect(result.briefingText).toMatch(/^현재 위치에서 강남역까지 최적 경로로/);
    expect(result.briefingText).not.toContain('현재 위치역');
  });

  it('저장한 집과 학교에도 역을 붙이지 않는다', async () => {
    const toHome = await briefing('현재 위치', '집');
    const fromSchool = await briefing('학교', '강남');

    expect(toHome.briefingText).toMatch(/^현재 위치에서 집까지 최적 경로로/);
    expect(fromSchool.briefingText).toMatch(/^학교에서 강남역까지 최적 경로로/);
  });
});
