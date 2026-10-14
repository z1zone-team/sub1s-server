import {
  PreferenceModel,
  validPreference,
} from '../../../domain/subway/models/preference-model';
import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { NicknameTakenError } from '../../../domain/user/errors/nickname-taken.error';
import {
  MAX_NICKNAME_ATTEMPTS,
  nicknameCandidate,
  normalizeNickname,
} from '../../../domain/user/models/nickname';
import { UserPreferences } from '../../../domain/user/models/preferences';
import {
  IUserRepository,
  UpdateProfileData,
  UpsertClerkUserData,
  UserWithLatestRank,
} from '../../../domain/user/ports/IUserRepository';
import { PrismaService } from '../../prisma/prisma.service';

type UniqueTarget = 'nickname' | 'clerk_id';

// Prisma가 닉네임 인덱스는 "lower(nickname::text)", 컬럼은 "clerk_id"로 알려준다
function isUniqueViolation(error: unknown, target: UniqueTarget): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String(error.meta?.target ?? '').includes(target)
  );
}

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPreferenceModel(
    userId: string,
  ): Promise<{ model: PreferenceModel; inputKey: string } | null> {
    const row = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { preferenceModelV2: true },
    });
    const stored = row?.preferenceModelV2 as unknown as
      { model: unknown; inputKey: string } | undefined;
    return stored &&
      validPreference(stored.model) &&
      typeof stored.inputKey === 'string'
      ? { model: stored.model, inputKey: stored.inputKey }
      : null;
  }

  async savePreferenceModel(
    userId: string,
    model: PreferenceModel,
    inputKey: string,
  ): Promise<void> {
    if (!validPreference(model))
      throw new Error('Invalid versioned preference model');
    const vector = `[${model.vector.join(',')}]`;
    const metadata = JSON.stringify({ model, inputKey });
    await this.prisma
      .$executeRaw`INSERT INTO user_preferences (user_id, preference_vector_v2, preference_model_v2, updated_at) VALUES (${userId}::uuid, ${vector}::vector, ${metadata}::jsonb, NOW()) ON CONFLICT (user_id) DO UPDATE SET preference_vector_v2 = EXCLUDED.preference_vector_v2, preference_model_v2 = EXCLUDED.preference_model_v2, updated_at = NOW()`;
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByIdWithLatestRank(id: string): Promise<UserWithLatestRank | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        rankScores: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { clerkId },
    });
  }

  async upsertByClerkId(data: UpsertClerkUserData): Promise<User> {
    const baseNickname = data.nickname || `탐험가_${data.clerkId.slice(-6)}`;

    return this.withUniqueNickname(baseNickname, (nickname) =>
      this.prisma.user.upsert({
        where: { clerkId: data.clerkId },
        update:
          data.profileImageUrl !== undefined
            ? { profileImageUrl: data.profileImageUrl }
            : {},
        create: {
          clerkId: data.clerkId,
          nickname,
          profileImageUrl: data.profileImageUrl ?? null,
        },
      }),
    );
  }

  async updateUser(
    id: string,
    data: { profileImageUrl?: string | null },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async updateProfile(id: string, data: UpdateProfileData): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.nickname !== undefined
            ? { nickname: data.nickname, nicknameCustomized: true }
            : {}),
          ...(data.rankingVisibility !== undefined
            ? { rankingVisibility: data.rankingVisibility }
            : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error, 'nickname')) {
        throw new NicknameTakenError(data.nickname ?? '');
      }
      throw error;
    }
  }

  async syncNickname(id: string, nickname: string): Promise<User> {
    return this.withUniqueNickname(nickname, (candidate) =>
      this.prisma.user.update({ where: { id }, data: { nickname: candidate } }),
    );
  }

  async isNicknameTaken(
    nickname: string,
    exceptUserId?: string,
  ): Promise<boolean> {
    const normalized = normalizeNickname(nickname);
    // ILIKE는 닉네임에 쓸 수 있는 "_"를 와일드카드로 취급해서 쓰지 않는다
    const rows = exceptUserId
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM users
          WHERE lower(nickname) = lower(${normalized}) AND id <> ${exceptUserId}::uuid
          LIMIT 1`
      : await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE lower(nickname) = lower(${normalized}) LIMIT 1`;
    return rows.length > 0;
  }

  async upsertPlaceholder(id: string, nickname = '테스트유저'): Promise<User> {
    return this.withUniqueNickname(nickname, (candidate) =>
      this.prisma.user.upsert({
        where: { id },
        update: {},
        create: {
          id,
          clerkId: `clerk_${id}`,
          nickname: candidate,
        },
      }),
    );
  }

  async findPreferences(userId: string): Promise<UserPreferences> {
    const row = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { purposes: true, routePrefs: true },
    });
    return {
      purposes: (row?.purposes ?? []) as UserPreferences['purposes'],
      routePrefs: (row?.routePrefs ?? []) as UserPreferences['routePrefs'],
    };
  }

  async replacePreferences(
    userId: string,
    data: UserPreferences,
  ): Promise<UserPreferences> {
    await this.prisma.userPreference.upsert({
      where: { userId },
      update: { purposes: data.purposes, routePrefs: data.routePrefs },
      create: { userId, purposes: data.purposes, routePrefs: data.routePrefs },
    });
    return this.findPreferences(userId);
  }

  // clerk_id 충돌은 동시에 온 요청이 먼저 만든 경우라 다음 시도에서 갱신으로 처리된다
  private async withUniqueNickname<T>(
    base: string,
    attemptWith: (nickname: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await attemptWith(nicknameCandidate(base, attempt));
      } catch (error) {
        const retryable =
          isUniqueViolation(error, 'nickname') ||
          isUniqueViolation(error, 'clerk_id');
        if (!retryable || attempt + 1 >= MAX_NICKNAME_ATTEMPTS) throw error;
      }
    }
  }
}
