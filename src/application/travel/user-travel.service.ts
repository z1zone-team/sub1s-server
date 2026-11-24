import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  FRIEND_REPOSITORY,
  IFriendRepository,
} from '../../domain/friend/ports/IFriendRepository';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import {
  LineMapResponseDto,
  TimelineResponseDto,
  TravelStatsResponseDto,
  UserLineMapQueryDto,
  UserLineMapResponseDto,
  UserTimelineQueryDto,
  UserTimelineResponseDto,
  UserTravelStatsQueryDto,
  UserTravelStatsResponseDto,
} from './dto';
import { TravelLogService } from './travel-log.service';

/**
 * 랭킹 등에서 고른 다른 사용자의 이동 기록 조회.
 * 공개 범위는 랭킹과 같다: 본인과 친구는 항상, 친구가 아니면 PUBLIC만 본다.
 * ANONYMOUS는 랭킹에서 userId가 가려지고 PRIVATE은 빠지므로 친구가 아니면 볼 수 없다
 */
@Injectable()
export class UserTravelService {
  constructor(
    private readonly travelLogService: TravelLogService,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    @Inject(FRIEND_REPOSITORY)
    private readonly friendRepo: IFriendRepository,
  ) {}

  async getTimeline(
    viewerId: string,
    targetUserId: string,
    query: UserTimelineQueryDto,
  ): Promise<UserTimelineResponseDto> {
    await this.assertCanView(viewerId, targetUserId);
    const timeline = await this.travelLogService.getTimeline(targetUserId, {
      year: query.year,
      month: query.month,
    });
    return toUserTimeline(targetUserId, timeline);
  }

  async getTravelStats(
    viewerId: string,
    targetUserId: string,
    query: UserTravelStatsQueryDto,
  ): Promise<UserTravelStatsResponseDto> {
    await this.assertCanView(viewerId, targetUserId);
    const stats = await this.travelLogService.aggregateTravelStats(
      targetUserId,
      query.period,
    );
    return toUserTravelStats(stats);
  }

  async getLineMap(
    viewerId: string,
    targetUserId: string,
    query: UserLineMapQueryDto,
  ): Promise<UserLineMapResponseDto> {
    await this.assertCanView(viewerId, targetUserId);
    const lineMap = await this.travelLogService.buildLineMap(
      targetUserId,
      query.period,
    );
    return toUserLineMap(lineMap);
  }

  private async assertCanView(
    viewerId: string,
    targetUserId: string,
  ): Promise<void> {
    if (viewerId === targetUserId) return;

    const target = await this.userRepo.findById(targetUserId);
    if (!target) {
      throw new BusinessException(
        'USER_NOT_FOUND',
        '사용자를 찾을 수 없어요.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (target.rankingVisibility === 'PUBLIC') return;
    // 친구는 공개 범위와 상관없이 본다(#264). 공개 범위는 친구가 아닌 사람에게만 적용한다
    const friend = await this.friendRepo.findFriend(viewerId, targetUserId);
    if (friend) return;
    throw new BusinessException(
      'FORBIDDEN_TRAVEL_HISTORY',
      '이 사용자의 이동 기록은 볼 수 없어요.',
      HttpStatus.FORBIDDEN,
    );
  }
}

// 내 기록 응답에서 공개할 필드만 골라 옮긴다. 필드를 줄일 때 여기서 뺀다

function toUserTimeline(
  userId: string,
  timeline: TimelineResponseDto,
): UserTimelineResponseDto {
  return {
    userId,
    totalDistanceKm: timeline.totalDistanceKm,
    totalLogsCount: timeline.totalLogsCount,
    logs: timeline.logs.map((log) => ({
      id: log.id,
      originStationName: log.originStationName,
      destStationName: log.destStationName,
      distanceKm: log.distanceKm,
      traveledAt: log.traveledAt,
      lineIds: log.lineIds,
      isExpress: log.isExpress,
      durationSec: log.durationSec,
      stationIds: log.stationIds,
    })),
  };
}

function toUserTravelStats(
  stats: TravelStatsResponseDto,
): UserTravelStatsResponseDto {
  return {
    userId: stats.userId,
    period: stats.period,
    totalDistanceKm: stats.totalDistanceKm,
    totalTravelCount: stats.totalTravelCount,
    transferCount: stats.transferCount,
    totalRideDurationSec: stats.totalRideDurationSec,
    mostVisitedStations: stats.mostVisitedStations.map((station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      visitCount: station.visitCount,
    })),
    mostUsedLineId: stats.mostUsedLineId,
    buckets: stats.buckets.map((bucket) => ({
      key: bucket.key,
      distanceKm: bucket.distanceKm,
      rideCount: bucket.rideCount,
    })),
    lineBreakdown: stats.lineBreakdown.map((line) => ({
      lineId: line.lineId,
      distanceKm: line.distanceKm,
      rideDurationSec: line.rideDurationSec,
    })),
  };
}

function toUserLineMap(lineMap: LineMapResponseDto): UserLineMapResponseDto {
  return {
    userId: lineMap.userId,
    period: lineMap.period,
    lines: lineMap.lines.map((line) => ({
      lineId: line.lineId,
      lineName: line.lineName,
      colorHex: line.colorHex,
      stations: line.stations.map((station) => ({
        stationId: station.stationId,
        stationName: station.stationName,
        lineSeq: station.lineSeq,
        lat: station.lat,
        lng: station.lng,
        visited: station.visited,
      })),
      links: line.links.map((link) => ({
        fromStationId: link.fromStationId,
        toStationId: link.toStationId,
      })),
    })),
  };
}
