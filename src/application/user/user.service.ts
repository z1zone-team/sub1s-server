import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { NicknameTakenError } from '../../domain/user/errors/nickname-taken.error';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { MyProfileResponseDto } from './dto/my-profile-response.dto';
import {
  PreferencesResponseDto,
  UpdatePreferencesRequestDto,
} from './dto/preferences.dto';
import { UpdateProfileRequestDto } from './dto/update-profile-request.dto';

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  async updateProfile(
    userId: string,
    dto: UpdateProfileRequestDto,
  ): Promise<MyProfileResponseDto> {
    if (
      dto.name === undefined &&
      dto.nickname === undefined &&
      dto.rankingVisibility === undefined
    ) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'at least one of name, nickname, rankingVisibility is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.requireUser(userId);

    if (
      dto.nickname !== undefined &&
      (await this.userRepo.isNicknameTaken(dto.nickname, userId))
    ) {
      throw this.nicknameTaken(dto.nickname);
    }

    try {
      const user = await this.userRepo.updateProfile(userId, dto);
      return {
        userId: user.id,
        name: user.name,
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl,
        rankingVisibility: user.rankingVisibility,
      };
    } catch (error) {
      if (error instanceof NicknameTakenError) {
        throw this.nicknameTaken(error.nickname);
      }
      throw error;
    }
  }

  async getPreferences(userId: string): Promise<PreferencesResponseDto> {
    await this.requireUser(userId);
    return this.userRepo.findPreferences(userId);
  }

  async replacePreferences(
    userId: string,
    dto: UpdatePreferencesRequestDto,
  ): Promise<PreferencesResponseDto> {
    await this.requireUser(userId);
    return this.userRepo.replacePreferences(userId, {
      purposes: dto.purposes,
      routePrefs: dto.routePrefs,
    });
  }

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.userRepo.findById(userId))) {
      throw new BusinessException(
        'USER_NOT_FOUND',
        'user not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private nicknameTaken(nickname: string): BusinessException {
    return new BusinessException(
      'NICKNAME_TAKEN',
      `nickname already in use: ${nickname}`,
      HttpStatus.CONFLICT,
    );
  }
}
