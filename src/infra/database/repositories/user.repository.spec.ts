import { Prisma } from '@prisma/client';
import { NicknameTakenError } from '../../../domain/user/errors/nickname-taken.error';
import { UserRepository } from './user.repository';

const uniqueViolation = (target: string) =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [target] },
  });

const nicknameViolation = () => uniqueViolation('lower(nickname::text)');
const clerkIdViolation = () => uniqueViolation('clerk_id');

describe('UserRepository', () => {
  let prisma: {
    user: { upsert: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let repo: UserRepository;

  beforeEach(() => {
    prisma = {
      user: {
        upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: 'u1', ...create })),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'u1', ...data })),
      },
      $queryRaw: jest.fn(),
    };
    repo = new UserRepository(prisma as never);
  });

  describe('upsertByClerkId', () => {
    it('uses the given nickname when it is free', async () => {
      await repo.upsertByClerkId({ clerkId: 'clerk_abcdef', nickname: '철도매니아' });

      expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.user.upsert.mock.calls[0][0].create.nickname).toBe('철도매니아');
    });

    it('falls back to the default nickname built from the clerk id', async () => {
      await repo.upsertByClerkId({ clerkId: 'user_2abcXYZ789' });

      expect(prisma.user.upsert.mock.calls[0][0].create.nickname).toBe('탐험가_XYZ789');
    });

    it('retries with a suffix while the nickname is taken', async () => {
      prisma.user.upsert
        .mockRejectedValueOnce(nicknameViolation())
        .mockRejectedValueOnce(nicknameViolation());

      await repo.upsertByClerkId({ clerkId: 'clerk_1', nickname: 'Kim' });

      const nicknames = prisma.user.upsert.mock.calls.map((call) => call[0].create.nickname as string);
      expect(nicknames).toHaveLength(3);
      expect(nicknames[0]).toBe('Kim');
      expect(nicknames[1]).toMatch(/^Kim_[0-9a-f]{4}$/);
      expect(nicknames[2]).toMatch(/^Kim_[0-9a-f]{4}$/);
    });

    it('gives up after too many collisions', async () => {
      prisma.user.upsert.mockRejectedValue(nicknameViolation());

      await expect(repo.upsertByClerkId({ clerkId: 'clerk_1', nickname: 'Kim' })).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(prisma.user.upsert).toHaveBeenCalledTimes(6);
    });

    it('retries when a concurrent request created the same clerk user first', async () => {
      prisma.user.upsert.mockRejectedValueOnce(clerkIdViolation());

      await repo.upsertByClerkId({ clerkId: 'clerk_1', nickname: 'Kim' });

      expect(prisma.user.upsert).toHaveBeenCalledTimes(2);
    });

    it('does not retry other errors', async () => {
      prisma.user.upsert.mockRejectedValueOnce(new Error('db down'));

      await expect(repo.upsertByClerkId({ clerkId: 'clerk_1', nickname: 'Kim' })).rejects.toThrow('db down');
      expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    });

    it('never overwrites the nickname of an existing user', async () => {
      await repo.upsertByClerkId({ clerkId: 'clerk_1', nickname: 'FromClerk', profileImageUrl: 'https://img' });

      const { update } = prisma.user.upsert.mock.calls[0][0];
      expect(update).toEqual({ profileImageUrl: 'https://img' });
      expect(update).not.toHaveProperty('nickname');
    });

    it('leaves an existing user untouched when no profile image is given', async () => {
      await repo.upsertByClerkId({ clerkId: 'clerk_1', nickname: 'FromClerk' });

      expect(prisma.user.upsert.mock.calls[0][0].update).toEqual({});
    });
  });

  describe('upsertPlaceholder', () => {
    it('gets a suffix when the placeholder nickname is taken', async () => {
      prisma.user.upsert.mockRejectedValueOnce(nicknameViolation());

      await repo.upsertPlaceholder('id-1');

      const nicknames = prisma.user.upsert.mock.calls.map((call) => call[0].create.nickname as string);
      expect(nicknames[0]).toBe('테스트유저');
      expect(nicknames[1]).toMatch(/^테스트유저_[0-9a-f]{4}$/);
    });
  });

  describe('updateProfile', () => {
    it('writes only the given fields', async () => {
      await repo.updateProfile('u1', { nickname: '새닉네임' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { nickname: '새닉네임', nicknameCustomized: true },
      });
    });

    it('does not mark the nickname as chosen when only other fields change', async () => {
      await repo.updateProfile('u1', { name: '이름' });

      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('nicknameCustomized');
    });

    it('clears the name with null and leaves it alone with undefined', async () => {
      await repo.updateProfile('u1', { name: null });
      await repo.updateProfile('u1', { nickname: 'abc' });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: null });
      expect(prisma.user.update.mock.calls[1][0].data).not.toHaveProperty('name');
    });

    it.each([
      ['PUBLIC', true],
      ['ANONYMOUS', true],
      ['PRIVATE', false],
    ] as const)('keeps the deprecated isRankingPublic in sync for %s', async (rankingVisibility, isRankingPublic) => {
      await repo.updateProfile('u1', { rankingVisibility });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ rankingVisibility, isRankingPublic });
    });

    it('turns a nickname unique violation into NicknameTakenError', async () => {
      prisma.user.update.mockRejectedValueOnce(nicknameViolation());

      await expect(repo.updateProfile('u1', { nickname: 'Kim' })).rejects.toBeInstanceOf(NicknameTakenError);
    });

    it('lets other errors through', async () => {
      prisma.user.update.mockRejectedValueOnce(clerkIdViolation());

      await expect(repo.updateProfile('u1', { name: '이름' })).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
    });
  });

  describe('syncNickname', () => {
    it('sets the nickname without marking it as chosen by the user', async () => {
      await repo.syncNickname('u1', '클러크이름');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { nickname: '클러크이름' },
      });
    });

    it('retries with a suffix while the nickname is taken', async () => {
      prisma.user.update.mockRejectedValueOnce(nicknameViolation());

      await repo.syncNickname('u1', 'Kim');

      const nicknames = prisma.user.update.mock.calls.map((call) => call[0].data.nickname as string);
      expect(nicknames[0]).toBe('Kim');
      expect(nicknames[1]).toMatch(/^Kim_[0-9a-f]{4}$/);
    });
  });

  describe('isNicknameTaken', () => {
    it('is true when a row matches', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'other' }]);

      await expect(repo.isNicknameTaken('Kim')).resolves.toBe(true);
    });

    it('is false when nothing matches', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(repo.isNicknameTaken('Kim', 'u1')).resolves.toBe(false);
    });
  });
});
