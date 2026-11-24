import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PreferenceModelService } from '../src/application/route/preference-model.service';
import {
  NEIGHBOR_CANDIDATE_LIMIT,
  PREFERENCE_EMBEDDING_DIMENSIONS,
} from '../src/domain/subway/models/neighbor-preference';
import {
  PREFERENCE_AXES,
  PREFERENCE_VERSION,
  PreferenceModel,
} from '../src/domain/subway/models/preference-model';
import { UserRepository } from '../src/infra/database/repositories/user.repository';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Neighbor selection with preference embeddings (e2e)', () => {
  const prisma = new PrismaService();
  const repository = new UserRepository(prisma);
  const tag = randomUUID().slice(0, 8);

  // 다른 e2e의 벡터(0.4~1)와 섞이지 않도록 0.06~0.09 근처를 쓴다
  const ME = 0.061;
  const filled = (value: number) => PREFERENCE_AXES.map(() => value);
  const model = (value: number): PreferenceModel => ({
    modelVersion: PREFERENCE_VERSION,
    axisKeys: [...PREFERENCE_AXES],
    vector: filled(value),
    observationCounts: filled(0),
    confidence: filled(0),
    source: 'SURVEY',
  });
  /** index 위치만 1인 단위 벡터. 같으면 코사인 거리 0, 다르면 1 */
  const unit = (index: number) =>
    Array.from({ length: PREFERENCE_EMBEDDING_DIMENSIONS }, (_, i) =>
      i === index ? 1 : 0,
    );

  const users: Record<
    string,
    { id: string; value: number; embedding?: number[] }
  > = {
    me: { id: randomUUID(), value: ME, embedding: unit(0) },
    // L2로는 가장 가깝지만 임베딩이 다르다
    closeOther: { id: randomUUID(), value: 0.0611, embedding: unit(1) },
    // L2로는 조금 멀지만 임베딩이 같다
    fartherSame: { id: randomUUID(), value: 0.0613, embedding: unit(0) },
    // 임베딩이 없다
    noEmbedding: { id: randomUUID(), value: 0.0612 },
  };
  // 1단계 후보 수를 채우는 사용자. 모두 me와 L2로 가깝고 임베딩이 없다
  const fillers = Array.from({ length: NEIGHBOR_CANDIDATE_LIMIT }, (_, i) => ({
    id: randomUUID(),
    value: 0.0615 + i * 0.00001,
  }));
  // 임베딩은 같지만 L2로 1단계 후보 밖에 있다
  const outside = { id: randomUUID(), value: 0.089, embedding: unit(0) };
  const allIds = [
    ...Object.values(users).map((u) => u.id),
    ...fillers.map((u) => u.id),
    outside.id,
  ];

  const vectorValues = (vectors: number[][]) => vectors.map((v) => v[0]);

  beforeAll(async () => {
    await prisma.$connect();
    const everyone = [
      ...Object.entries(users).map(([name, u]) => ({ ...u, name })),
      ...fillers.map((u, i) => ({ ...u, name: `f${i}` })),
      { ...outside, name: 'outside' },
    ];
    await prisma.user.createMany({
      data: everyone.map(({ id, name }) => ({
        id,
        clerkId: `e2e_emb_${name}_${tag}`,
        nickname: `emb_${name}_${tag}`,
        rankingVisibility: 'PUBLIC' as const,
      })),
    });
    for (const u of everyone) {
      await repository.savePreferenceModel(u.id, model(u.value), u.name);
      if ('embedding' in u && u.embedding) {
        await repository.savePreferenceEmbedding(
          u.id,
          u.embedding,
          `key-${u.name}`,
        );
      }
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: allIds } } });
    await prisma.$disconnect();
  });

  it('stores and reads back the embedding with its input key', async () => {
    const stored = await repository.findPreferenceEmbedding(users.me.id);
    expect(stored).toEqual({ embedding: unit(0), inputKey: 'key-me' });
    expect(
      await repository.findPreferenceEmbedding(users.noEmbedding.id),
    ).toBeNull();
  });

  it('keeps the L2-only order without an embedding', async () => {
    const values = vectorValues(
      await repository.findNeighborPreferenceVectors(
        users.me.id,
        filled(ME),
        3,
      ),
    );
    expect(values[0]).toBeCloseTo(users.closeOther.value, 5);
    expect(values[1]).toBeCloseTo(users.noEmbedding.value, 5);
    expect(values[2]).toBeCloseTo(users.fartherSame.value, 5);
  });

  it('reorders the L2 candidates by embedding cosine distance, users without an embedding last', async () => {
    const values = vectorValues(
      await repository.findNeighborPreferenceVectors(
        users.me.id,
        filled(ME),
        NEIGHBOR_CANDIDATE_LIMIT,
        unit(0),
      ),
    );
    // 같은 임베딩(거리 0), 다른 임베딩(거리 1), 그다음 임베딩 없는 사용자를 L2 순으로
    expect(values[0]).toBeCloseTo(users.fartherSame.value, 5);
    expect(values[1]).toBeCloseTo(users.closeOther.value, 5);
    expect(values[2]).toBeCloseTo(users.noEmbedding.value, 5);
  });

  it('never picks a user outside the L2 candidates even with the same embedding', async () => {
    const values = vectorValues(
      await repository.findNeighborPreferenceVectors(
        users.me.id,
        filled(ME),
        1000,
        unit(0),
      ),
    );
    expect(values).toHaveLength(NEIGHBOR_CANDIDATE_LIMIT);
    expect(values.some((v) => Math.abs(v - outside.value) < 1e-6)).toBe(false);
  });

  it('runs through the real service with a stored embedding and keeps the 10-axis formula', async () => {
    const service = new PreferenceModelService(
      // AI 서버 주소가 없으면 임베딩을 새로 만들지 않는다. 저장된 임베딩을 쓰는지는 저장소 테스트로 본다
      new ConfigService({}),
      repository,
    );
    const result = await service.compute(users.me.id, [], [], {
      purposes: [],
      recentModes: [],
    });
    expect(result.neighbors).toBeGreaterThanOrEqual(5);
    expect(result.vector.every((x) => x >= 0 && x <= 1)).toBe(true);
  });
});
