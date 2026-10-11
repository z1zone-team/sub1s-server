import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  SUPPORTED_PUSH_PROVIDERS,
  isValidPushToken,
} from '../../domain/notification/models/push';
import {
  INotificationSettingsRepository,
  IPushTokenRepository,
  NOTIFICATION_SETTINGS_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
} from '../../domain/notification/ports/notification-ports';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import {
  NotificationSettingsResponseDto,
  PushTokenRegisteredResponseDto,
  PushTokenRemovedResponseDto,
  RegisterPushTokenRequestDto,
  UpdateNotificationSettingsRequestDto,
} from './dto/notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(PUSH_TOKEN_REPOSITORY)
    private readonly tokens: IPushTokenRepository,
    @Inject(NOTIFICATION_SETTINGS_REPOSITORY)
    private readonly settings: INotificationSettingsRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
  ) {}

  async registerToken(
    userId: string,
    dto: RegisterPushTokenRequestDto,
  ): Promise<PushTokenRegisteredResponseDto> {
    const provider = dto.provider ?? 'EXPO';
    if (!SUPPORTED_PUSH_PROVIDERS.includes(provider)) {
      throw new BusinessException(
        'UNSUPPORTED_PUSH_PROVIDER',
        `push provider not supported yet: ${provider}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!isValidPushToken(provider, dto.token)) {
      throw new BusinessException(
        'INVALID_PUSH_TOKEN',
        'push token has an invalid format',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.requireUser(userId);
    await this.tokens.register({
      userId,
      token: dto.token,
      provider,
      platform: dto.platform,
    });
    return { registered: true };
  }

  async removeToken(userId: string, token: string): Promise<PushTokenRemovedResponseDto> {
    return { removed: await this.tokens.remove(userId, token) };
  }

  async getSettings(userId: string): Promise<NotificationSettingsResponseDto> {
    await this.requireUser(userId);
    return this.settings.get(userId);
  }

  async updateSettings(
    userId: string,
    dto: UpdateNotificationSettingsRequestDto,
  ): Promise<NotificationSettingsResponseDto> {
    if (dto.monthlySettlement === undefined) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'at least one notification setting is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.requireUser(userId);
    return this.settings.update(userId, { monthlySettlement: dto.monthlySettlement });
  }

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.users.findById(userId))) {
      throw new BusinessException('USER_NOT_FOUND', 'user not found', HttpStatus.NOT_FOUND);
    }
  }
}
