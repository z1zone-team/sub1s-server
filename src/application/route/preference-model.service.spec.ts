import { ConfigService } from '@nestjs/config';
import { PreferenceModelService } from './preference-model.service';
import { surveyPreference } from '../../domain/subway/models/preference-model';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';

const users = {
  findPreferenceModel: jest.fn().mockResolvedValue(null),
  savePreferenceModel: jest.fn().mockResolvedValue(undefined),
  findNeighborPreferenceVectors: jest.fn(),
  findPreferenceEmbedding: jest.fn().mockResolvedValue(null),
  savePreferenceEmbedding: jest.fn().mockResolvedValue(undefined),
};
const service = () =>
  new PreferenceModelService(
    new ConfigService({ AI_SERVICE_URL: 'http://ai.test' }),
    users as unknown as IUserRepository,
  );
afterEach(() => {
  jest.restoreAllMocks();
  users.findPreferenceModel.mockClear();
  users.savePreferenceModel.mockClear();
  users.findNeighborPreferenceVectors.mockReset();
  users.findPreferenceEmbedding.mockReset().mockResolvedValue(null);
  users.savePreferenceEmbedding.mockClear();
});
it('sends only quantitative choices, validates the version and persists the model', async () => {
  const model = { ...surveyPreference(['LOW_FARE']), source: 'AI' };
  const fetcher = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: true, json: async () => model } as Response);
  const result = await service().compute(
    'user',
    ['LOW_FARE'],
    [
      {
        selected: { fare: 1500 },
        alternatives: [{ fare: 2000 }],
        routeFingerprint: 'private-history-identifier',
      },
    ],
  );
  expect(result).toEqual(model);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe('http://ai.test/api/v1/ai/preference-vector/v2');
  expect(JSON.parse(request!.body as string).choices).toEqual([
    { selected: { fare: 1500 }, alternatives: [{ fare: 2000 }] },
  ]);
  expect(users.savePreferenceModel).toHaveBeenCalledWith(
    'user',
    model,
    expect.any(String),
  );
});
it('rejects wrong axes and nonfinite values instead of using a corrupt stored model', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ ...surveyPreference([]), axisKeys: ['fare'] }),
  } as Response);
  expect(await service().compute('user', ['LOW_FARE'], [])).toEqual(
    surveyPreference(['LOW_FARE']),
  );
  expect(users.savePreferenceModel).toHaveBeenCalledWith(
    'user',
    surveyPreference(['LOW_FARE']),
    expect.any(String),
  );
});
it('keeps search available when AI is unavailable', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  expect(await service().compute('user', ['FAST'], [])).toEqual(
    surveyPreference(['FAST']),
  );
});
describe('neighbor prior', () => {
  const neighbors = (count: number, value: number) =>
    Array.from({ length: count }, () => Array(10).fill(value));

  it('mixes the neighbor mean into the search model but stores the model without it', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    users.findNeighborPreferenceVectors.mockResolvedValue(neighbors(5, 1));
    const result = await service().compute('user', [], []);
    expect(result.neighbors).toBe(5);
    expect(result.vector).toEqual(Array(10).fill(0.75));
    expect(users.findNeighborPreferenceVectors).toHaveBeenCalledWith(
      'user',
      surveyPreference([]).vector,
      20,
    );
    expect(users.savePreferenceModel).toHaveBeenCalledWith(
      'user',
      surveyPreference([]),
      expect.any(String),
    );
  });

  it('does not use too few neighbors', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    users.findNeighborPreferenceVectors.mockResolvedValue(neighbors(4, 1));
    expect(await service().compute('user', [], [])).toEqual(
      surveyPreference([]),
    );
  });

  it('keeps search available when the neighbor query fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    users.findNeighborPreferenceVectors.mockRejectedValue(new Error('db'));
    expect(await service().compute('user', ['FAST'], [])).toEqual(
      surveyPreference(['FAST']),
    );
  });
});

describe('preference embedding for neighbor selection', () => {
  const embedding = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
  const neighbors = Array.from({ length: 5 }, () => Array(10).fill(1));
  const context = {
    purposes: ['TRAVEL', 'COMMUTE'],
    recentModes: ['FEWEST_TRANSFERS', 'COMFORTABLE'],
  };
  const respond = (embeddingBody: unknown) =>
    jest
      .spyOn(global, 'fetch')
      .mockImplementation((async (url: string) =>
        String(url).endsWith('/preference-embedding')
          ? { ok: true, json: async () => embeddingBody }
          : Promise.reject(new Error('offline'))) as unknown as typeof fetch);

  it('sends sorted survey codes and recent modes, stores the embedding and ranks neighbors with it', async () => {
    const fetcher = respond({ embedding });
    users.findNeighborPreferenceVectors.mockResolvedValue(neighbors);
    const result = await service().compute(
      'user',
      ['FAST', 'EXPRESS'],
      [],
      context,
    );

    const call = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith('/preference-embedding'),
    )!;
    expect(call[0]).toBe('http://ai.test/api/v1/ai/preference-embedding');
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      purposes: ['COMMUTE', 'TRAVEL'],
      routePrefs: ['EXPRESS', 'FAST'],
      recentModes: ['FEWEST_TRANSFERS', 'COMFORTABLE'],
    });
    expect(users.savePreferenceEmbedding).toHaveBeenCalledWith(
      'user',
      embedding,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(users.findNeighborPreferenceVectors).toHaveBeenCalledWith(
      'user',
      surveyPreference(['FAST', 'EXPRESS']).vector,
      20,
      embedding,
    );
    // 10축 이웃 보정 식은 그대로다
    expect(result.neighbors).toBe(5);
  });

  it('reuses the stored embedding when the input is unchanged', async () => {
    const fetcher = respond({ embedding });
    users.findNeighborPreferenceVectors.mockResolvedValue(neighbors);
    await service().compute('user', ['FAST'], [], context);
    const key = users.savePreferenceEmbedding.mock.calls[0][2];
    fetcher.mockClear();
    users.findPreferenceEmbedding.mockResolvedValue({
      embedding,
      inputKey: key,
    });

    await service().compute('user', ['FAST'], [], context);

    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith('/preference-embedding'),
      ),
    ).toBe(false);
    expect(users.findNeighborPreferenceVectors).toHaveBeenLastCalledWith(
      'user',
      expect.any(Array),
      20,
      embedding,
    );
  });

  it.each([
    ['a wrong dimension', { embedding: [1, 0, 0] }],
    ['a nonfinite value', { embedding: [...embedding.slice(1), null] }],
  ])('falls back to L2-only neighbors for %s', async (_, body) => {
    respond(body);
    users.findNeighborPreferenceVectors.mockResolvedValue(neighbors);
    await service().compute('user', [], [], context);
    expect(users.savePreferenceEmbedding).not.toHaveBeenCalled();
    expect(users.findNeighborPreferenceVectors).toHaveBeenCalledWith(
      'user',
      surveyPreference([]).vector,
      20,
    );
  });

  it('keeps search available when the embedding service is down', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    users.findNeighborPreferenceVectors.mockResolvedValue(neighbors);
    const result = await service().compute('user', [], [], context);
    expect(result.neighbors).toBe(5);
    expect(users.findNeighborPreferenceVectors).toHaveBeenCalledWith(
      'user',
      surveyPreference([]).vector,
      20,
    );
  });

  it('does not call the embedding service without a context', async () => {
    const fetcher = respond({ embedding });
    await service().compute('user', [], []);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith('/preference-embedding'),
      ),
    ).toBe(false);
  });
});
