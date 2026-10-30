import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  USER_REPOSITORY,
  IUserRepository,
} from '../../domain/user/ports/IUserRepository';
import {
  NEIGHBOR_LIMIT,
  applyNeighborPrior,
  meanNeighborVector,
} from '../../domain/subway/models/neighbor-preference';
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
    const model = await this.computeModel(userId, routePrefs, choices);
    return this.withNeighborPrior(userId, routePrefs, model);
  }

  // 저장한 모델은 이웃 평균을 섞기 전 값이다. 섞은 값이 다시 이웃 평균에 들어가는 순환을 막는다
  private async withNeighborPrior(
    userId: string,
    routePrefs: string[],
    model: PreferenceModel,
  ): Promise<PreferenceModel> {
    try {
      const vectors = await this.users.findNeighborPreferenceVectors?.(
        userId,
        model.vector,
        NEIGHBOR_LIMIT,
      );
      const neighbors = vectors && meanNeighborVector(vectors);
      return neighbors
        ? applyNeighborPrior(model, routePrefs, neighbors.mean, neighbors.count)
        : model;
    } catch {
      return model;
    }
  }

  private async computeModel(
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
