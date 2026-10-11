import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IFriendRepository } from '../../domain/friend/ports/IFriendRepository';
import { IRankScoreRepository } from '../../domain/ranking/ports/IRankScoreRepository';
import { RankingQueryDto } from './dto';
import { RankingService } from './ranking.service';

describe('RankingService friendsOnly', () => {
  const score = (userId: string, totalPoints: number, rankingVisibility = 'PUBLIC') => ({
    userId,
    totalPoints,
    totalDistanceKm: 1,
    user: { nickname: `nick-${userId}`, profileImageUrl: null, rankingVisibility },
  });

  const query = (friendsOnly: boolean) => ({
    periodType: 'MONTHLY' as const,
    periodKey: '2026-10',
    friendsOnly,
    page: 1,
    limit: 20,
  });

  const build = (friendIds: string[]) => {
    const rankRepo = {
      findLeaderboard: jest.fn().mockResolvedValue([
        score('stranger', 500),
        score('friend-a', 400),
        score('me', 300),
        score('friend-anon', 200, 'ANONYMOUS'),
        score('friend-private', 150, 'PRIVATE'),
        score('friend-b', 100),
      ]),
    };
    const friendRepo = { findFriendIds: jest.fn().mockResolvedValue(friendIds) };
    const service = new RankingService(
      rankRepo as unknown as IRankScoreRepository,
      friendRepo as unknown as IFriendRepository,
    );
    return { service, friendRepo };
  };

  const friends = ['friend-a', 'friend-anon', 'friend-private', 'friend-b'];

  it('ranks only me and my friends', async () => {
    const { service } = build(friends);

    const res = await service.getRanking('me', query(true));

    expect(res.friendsOnly).toBe(true);
    expect(res.leaderboard.map((item) => item.rank)).toEqual([1, 2, 3, 4]);
    expect(res.leaderboard.map((item) => item.isMe)).toEqual([false, true, false, false]);
    expect(res.myRank).toBe(2);
    expect(res.totalUsers).toBe(4);
    expect(JSON.stringify(res)).not.toContain('stranger');
  });

  it('shows the nickname of an anonymous friend and hides a private friend', async () => {
    const { service } = build(friends);

    const res = await service.getRanking('me', query(true));

    const anon = res.leaderboard.find((item) => item.userId === 'friend-anon');
    expect(anon).toMatchObject({ nickname: 'nick-friend-anon', isAnonymous: false });
    expect(JSON.stringify(res)).not.toContain('friend-private');
  });

  it('keeps hiding an anonymous stranger in the full ranking', async () => {
    const { service, friendRepo } = build([]);

    const res = await service.getRanking('me', query(false));

    expect(friendRepo.findFriendIds).not.toHaveBeenCalled();
    expect(res.friendsOnly).toBe(false);
    expect(res.leaderboard.find((item) => item.rank === 3)).toMatchObject({ isMe: true });
    expect(res.leaderboard.find((item) => item.nickname === '익명')).toBeDefined();
  });

  it('ranks me alone when there are no friends', async () => {
    const { service } = build([]);

    const res = await service.getRanking('me', query(true));

    expect(res.totalUsers).toBe(1);
    expect(res.myRank).toBe(1);
  });
});

describe('RankingQueryDto friendsOnly', () => {
  const parse = (friendsOnly: unknown) => {
    const dto = plainToInstance(RankingQueryDto, { periodType: 'MONTHLY', periodKey: '2026-10', friendsOnly });
    return { dto, errors: validateSync(dto) };
  };

  it('reads the query strings true and false', () => {
    expect(parse('true').dto.friendsOnly).toBe(true);
    expect(parse('false').dto.friendsOnly).toBe(false);
    expect(parse('true').errors).toHaveLength(0);
    expect(parse('false').errors).toHaveLength(0);
  });

  it('rejects other values', () => {
    expect(parse('yes').errors.length).toBeGreaterThan(0);
  });
});
