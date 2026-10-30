import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RankingVisibility } from '@prisma/client';
import { PreferenceModelService } from '../src/application/route/preference-model.service';
import {
  PREFERENCE_AXES,
  PREFERENCE_VERSION,
  PreferenceModel,
} from '../src/domain/subway/models/preference-model';
import { UserRepository } from '../src/infra/database/repositories/user.repository';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Neighbor preference vectors (e2e)', () => {
  const prisma = new PrismaService();
  const repository = new UserRepository(prisma);
  const tag = randomUUID().slice(0, 8);

  // 다른 e2e가 남긴 벡터와 구분되도록 설문값(0.5, 1)이 아닌 값을 쓴다
  const fixtures: Record<
    string,
    { value: number; visibility: RankingVisibility }
  > = {
    me: { value: 0.401, visibility: 'PUBLIC' },
    hidden: { value: 0.402, visibility: 'PRIVATE' },
    near: { value: 0.411, visibility: 'PUBLIC' },
    anonymous: { value: 0.421, visibility: 'ANONYMOUS' },
    extraA: { value: 0.431, visibility: 'PUBLIC' },
    extraB: { value: 0.441, visibility: 'PUBLIC' },
    mid: { value: 0.601, visibility: 'PUBLIC' },
    far: { value: 0.911, visibility: 'PUBLIC' },
  };
  const ids = Object.fromEntries(
    Object.keys(fixtures).map((name) => [name, randomUUID()]),
  );
  const filled = (value: number) => PREFERENCE_AXES.map(() => value);
  const model = (value: number): PreferenceModel => ({
    modelVersion: PREFERENCE_VERSION,
    axisKeys: [...PREFERENCE_AXES],
    vector: filled(value),
    observationCounts: filled(0),
    confidence: filled(0),
    source: 'SURVEY',
  });

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: Object.entries(fixtures).map(([name, { visibility }]) => ({
        id: ids[name],
        clerkId: `e2e_nb_${name}_${tag}`,
        nickname: `nb_${name}_${tag}`,
        rankingVisibility: visibility,
      })),
    });
    for (const [name, { value }] of Object.entries(fixtures)) {
      await repository.savePreferenceModel(ids[name], model(value), name);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it('returns nearby vectors closest first, without the user or PRIVATE users', async () => {
    const vectors = await repository.findNeighborPreferenceVectors(
      ids.me,
      filled(fixtures.me.value),
      1000,
    );
    const mine = new Set(Object.values(fixtures).map(({ value }) => value));
    const found = vectors
      .map((vector) => vector[0])
      .filter((value) => [...mine].some((m) => Math.abs(m - value) < 1e-4));
    const expected = ['near', 'anonymous', 'extraA', 'extraB', 'mid', 'far'];
    expect(found).toHaveLength(expected.length);
    expected.forEach((name, index) =>
      expect(found[index]).toBeCloseTo(fixtures[name].value, 4),
    );
    expect(vectors.every((vector) => vector.length === 10)).toBe(true);
  });

  it('respects the limit', async () => {
    const vectors = await repository.findNeighborPreferenceVectors(
      ids.me,
      filled(fixtures.me.value),
      2,
    );
    expect(vectors).toHaveLength(2);
  });

  it('mixes the neighbor mean through the real service and stores the model without it', async () => {
    const service = new PreferenceModelService(
      new ConfigService({}),
      repository,
    );
    const result = await service.compute(ids.me, [], []);
    expect(result.neighbors).toBeGreaterThanOrEqual(5);
    expect(result.vector.some((x) => x !== 0.5)).toBe(true);
    expect(result.vector.every((x) => x >= 0 && x <= 1)).toBe(true);
    const stored = await repository.findPreferenceModel(ids.me);
    expect(stored!.model.vector).toEqual(filled(0.5));
    expect(stored!.model.neighbors).toBeUndefined();
  });
});
