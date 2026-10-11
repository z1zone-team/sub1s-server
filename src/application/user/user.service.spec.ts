import { HttpStatus } from '@nestjs/common';
import { NicknameTakenError } from '../../domain/user/errors/nickname-taken.error';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';
import { UserService } from './user.service';

describe('UserService', () => {
  let repo: jest.Mocked<Pick<
      IUserRepository,
      | 'findById'
      | 'updateProfile'
      | 'isNicknameTaken'
      | 'findPreferences'
      | 'replacePreferences'
    >>;
  let service: UserService;

  const user = {
    id: 'user-1',
    clerkId: 'clerk-1',
    name: '박지훈',
    nickname: '내출신은리',
    profileImageUrl: null,
    rankingVisibility: 'ANONYMOUS' as const,
    isRankingPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    repo = {
      findById: jest.fn().mockResolvedValue(user),
      updateProfile: jest.fn().mockResolvedValue(user),
      isNicknameTaken: jest.fn().mockResolvedValue(false),
      findPreferences: jest.fn().mockResolvedValue({ purposes: [], routePrefs: [] }),
      replacePreferences: jest.fn(),
    };
    service = new UserService(repo as unknown as IUserRepository);
  });

  it('updates only the given fields and returns the profile', async () => {
    const result = await service.updateProfile('user-1', { rankingVisibility: 'ANONYMOUS' });

    expect(repo.updateProfile).toHaveBeenCalledWith('user-1', { rankingVisibility: 'ANONYMOUS' });
    expect(result).toEqual({
      userId: 'user-1',
      name: '박지훈',
      nickname: '내출신은리',
      profileImageUrl: null,
      rankingVisibility: 'ANONYMOUS',
    });
  });

  it('rejects a request with nothing to update', async () => {
    await expect(service.updateProfile('user-1', {})).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST_PAYLOAD',
      status: HttpStatus.BAD_REQUEST,
    });
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });

  it('accepts null as a request to clear the name', async () => {
    await service.updateProfile('user-1', { name: null });

    expect(repo.updateProfile).toHaveBeenCalledWith('user-1', { name: null });
  });

  it('returns 404 when the user does not exist', async () => {
    repo.findById.mockResolvedValueOnce(null);

    await expect(service.updateProfile('ghost', { name: '이름' })).rejects.toMatchObject({
      errorCode: 'USER_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('returns 409 and writes nothing when another user has the nickname', async () => {
    repo.isNicknameTaken.mockResolvedValueOnce(true);

    await expect(service.updateProfile('user-1', { nickname: 'Kim' })).rejects.toMatchObject({
      errorCode: 'NICKNAME_TAKEN',
      status: HttpStatus.CONFLICT,
    });
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });

  it('excludes the user from the nickname check so they can keep or re-case their own', async () => {
    await service.updateProfile('user-1', { nickname: 'KIM' });

    expect(repo.isNicknameTaken).toHaveBeenCalledWith('KIM', 'user-1');
  });

  it('returns 409 when the database rejects the nickname after the check passed', async () => {
    repo.updateProfile.mockRejectedValueOnce(new NicknameTakenError('Kim'));

    await expect(service.updateProfile('user-1', { nickname: 'Kim' })).rejects.toMatchObject({
      errorCode: 'NICKNAME_TAKEN',
      status: HttpStatus.CONFLICT,
    });
  });

  it('does not check the nickname when it is not being changed', async () => {
    await service.updateProfile('user-1', { name: '새이름' });

    expect(repo.isNicknameTaken).not.toHaveBeenCalled();
  });

  it('lets unexpected errors through', async () => {
    repo.updateProfile.mockRejectedValueOnce(new Error('db down'));

    await expect(service.updateProfile('user-1', { name: '이름' })).rejects.toThrow('db down');
  });

  describe('preferences', () => {
    const saved = { purposes: ['COMMUTE' as const], routePrefs: ['FAST' as const] };

    it('returns empty arrays before the survey', async () => {
      expect(await service.getPreferences('user-1')).toEqual({ purposes: [], routePrefs: [] });
    });

    it('replaces the survey answers and returns what was stored', async () => {
      repo.replacePreferences.mockResolvedValue(saved);

      const result = await service.replacePreferences('user-1', saved);

      expect(repo.replacePreferences).toHaveBeenCalledWith('user-1', saved);
      expect(result).toEqual(saved);
    });

    it('rejects an unknown user for both reads and writes', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getPreferences('ghost')).rejects.toMatchObject({
        errorCode: 'USER_NOT_FOUND',
      });
      await expect(service.replacePreferences('ghost', saved)).rejects.toMatchObject({
        errorCode: 'USER_NOT_FOUND',
      });
      expect(repo.replacePreferences).not.toHaveBeenCalled();
    });
  });
});
