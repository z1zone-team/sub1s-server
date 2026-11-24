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
  validEmbedding,
} from '../../domain/subway/models/neighbor-preference';
import {
  ChoiceSnapshot,
  PreferenceModel,
  surveyPreference,
  validPreference,
} from '../../domain/subway/models/preference-model';

/** 취향 문장 임베딩의 입력. 10축 계산에는 쓰지 않는다 */
export interface EmbeddingContext {
  purposes: string[];
  /** 최근 이동 기록에서 고른 경로 모드, 최신순 */
  recentModes: string[];
}

/** 입력 해시에 넣는 버전. 문장 규칙이나 모델을 바꾸면 올려서 저장한 임베딩을 다시 만든다 */
const EMBEDDING_INPUT_VERSION = 'preference-embedding-e5-small-v1';

@Injectable()
export class PreferenceModelService {
  constructor(
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  /**
   * 10축 모델을 계산하고 이웃 평균을 섞는다. context가 있으면 취향 문장 임베딩을 함께 구해
   * 이웃을 고를 때 2단계 정렬(10축 L2 후보 안에서 임베딩 코사인 유사도 순)에 쓴다.
   * 임베딩은 10축 계산 공식에 들어가지 않는다
   */
  async compute(
    userId: string,
    routePrefs: string[],
    choices: ChoiceSnapshot[],
    context?: EmbeddingContext,
  ): Promise<PreferenceModel> {
    const embedding = context
      ? this.embeddingFor(userId, routePrefs, context)
      : Promise.resolve(undefined);
    const model = await this.computeModel(userId, routePrefs, choices);
    return this.withNeighborPrior(userId, routePrefs, model, await embedding);
  }

  // 저장한 모델은 이웃 평균을 섞기 전 값이다. 섞은 값이 다시 이웃 평균에 들어가는 순환을 막는다
  private async withNeighborPrior(
    userId: string,
    routePrefs: string[],
    model: PreferenceModel,
    embedding?: number[],
  ): Promise<PreferenceModel> {
    try {
      const vectors = await (embedding
        ? this.users.findNeighborPreferenceVectors?.(
            userId,
            model.vector,
            NEIGHBOR_LIMIT,
            embedding,
          )
        : this.users.findNeighborPreferenceVectors?.(
            userId,
            model.vector,
            NEIGHBOR_LIMIT,
          ));
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

  /**
   * 이동 목적, 경로 취향, 최근 고른 경로 모드로 만든 취향 문장의 임베딩.
   * 입력이 같으면 저장한 값을 쓰고, 바뀌었을 때만 AI 서버를 부른다. 실패하면 undefined라 이웃은 L2만으로 고른다
   */
  private async embeddingFor(
    userId: string,
    routePrefs: string[],
    context: EmbeddingContext,
  ): Promise<number[] | undefined> {
    const base = this.config.get<string>('AI_SERVICE_URL');
    if (!base) return undefined;
    const request = {
      purposes: [...context.purposes].sort(),
      routePrefs: [...routePrefs].sort(),
      recentModes: [...context.recentModes],
    };
    const inputKey = createHash('sha256')
      .update(JSON.stringify({ version: EMBEDDING_INPUT_VERSION, ...request }))
      .digest('hex');
    try {
      const stored = await this.users.findPreferenceEmbedding?.(userId);
      if (stored?.inputKey === inputKey) return stored.embedding;
    } catch {
      /* 마이그레이션 전 DB여도 검색은 계속한다 */
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2000);
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/api/v1/ai/preference-embedding`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: abort.signal,
        },
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as { embedding?: unknown };
      if (!validEmbedding(body?.embedding)) return undefined;
      try {
        await this.users.savePreferenceEmbedding?.(
          userId,
          body.embedding,
          inputKey,
        );
      } catch {
        /* 저장에 실패해도 이번 검색에는 쓴다 */
      }
      return body.embedding;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
