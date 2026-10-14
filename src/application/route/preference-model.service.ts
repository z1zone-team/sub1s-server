import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  USER_REPOSITORY,
  IUserRepository,
} from '../../domain/user/ports/IUserRepository';
import {
  ChoiceSnapshot,
  PreferenceModel,
  surveyPreference,
  validPreference,
} from '../../domain/subway/models/preference-model';

@Injectable()
export class PreferenceModelService {
  constructor(
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async compute(
    userId: string,
    routePrefs: string[],
    choices: ChoiceSnapshot[],
  ): Promise<PreferenceModel> {
    const fallback = surveyPreference(routePrefs);
    const base = this.config.get<string>('AI_SERVICE_URL');
    const persist = async (
      model: PreferenceModel,
    ): Promise<PreferenceModel> => {
      try {
        await this.users.savePreferenceModel?.(userId, model, inputKey);
      } catch {
        /* Rolling migration fallback. */
      }
      return model;
    };
    const inputKey = createHash('sha256')
      .update(JSON.stringify({ routePrefs: [...routePrefs].sort(), choices }))
      .digest('hex');
    try {
      const stored = await this.users.findPreferenceModel?.(userId);
      if (
        stored?.inputKey === inputKey &&
        validPreference(stored.model) &&
        (stored.model.source === 'AI' || !base)
      )
        return stored.model;
    } catch {
      /* An unmigrated database must not prevent route search. */
    }
    if (!base) return persist(fallback);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2000);
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/api/v1/ai/preference-vector/v2`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routePrefs,
            choices: choices.map(({ selected, alternatives }) => ({
              selected,
              alternatives,
            })),
          }),
          signal: abort.signal,
        },
      );
      if (!response.ok) return persist(fallback);
      const model: unknown = await response.json();
      if (!validPreference(model) || model.source !== 'AI')
        return persist(fallback);
      try {
        await this.users.savePreferenceModel?.(userId, model, inputKey);
      } catch {
        /* Fallback for rolling database migration. */
      }
      return model;
    } catch {
      return persist(fallback);
    } finally {
      clearTimeout(timer);
    }
  }
}
