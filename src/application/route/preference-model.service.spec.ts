import { ConfigService } from '@nestjs/config';
import { PreferenceModelService } from './preference-model.service';
import { surveyPreference } from '../../domain/subway/models/preference-model';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';

const users = {
  findPreferenceModel: jest.fn().mockResolvedValue(null),
  savePreferenceModel: jest.fn().mockResolvedValue(undefined),
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
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
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
