import { HttpStatus } from '@nestjs/common';
import {
  INotificationSettingsRepository,
  IPushTokenRepository,
} from '../../domain/notification/ports/notification-ports';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
  let tokens: jest.Mocked<IPushTokenRepository>;
  let settings: jest.Mocked<INotificationSettingsRepository>;
  let users: { findById: jest.Mock };
  let service: NotificationService;

  beforeEach(() => {
    tokens = {
      register: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(true),
      findByUserIds: jest.fn(),
      deleteTokens: jest.fn(),
    };
    settings = {
      get: jest.fn().mockResolvedValue({ monthlySettlement: true }),
      update: jest.fn().mockImplementation(async (_id, patch) => ({ monthlySettlement: true, ...patch })),
      findMonthlySettlementDisabled: jest.fn(),
    };
    users = { findById: jest.fn().mockResolvedValue({ id: 'u1' }) };
    service = new NotificationService(tokens, settings, users as unknown as IUserRepository);
  });

  describe('registerToken', () => {
    it('registers an Expo token with the platform for the user', async () => {
      const result = await service.registerToken('u1', { token: TOKEN, platform: 'ios' });

      expect(result).toEqual({ registered: true });
      expect(tokens.register).toHaveBeenCalledWith({
        userId: 'u1',
        token: TOKEN,
        provider: 'EXPO',
        platform: 'ios',
      });
    });

    it('rejects a token with the wrong format', async () => {
      await expect(service.registerToken('u1', { token: 'not-a-token' })).rejects.toMatchObject({
        errorCode: 'INVALID_PUSH_TOKEN',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(tokens.register).not.toHaveBeenCalled();
    });

    it('rejects token kinds the server cannot send to yet', async () => {
      for (const provider of ['FCM', 'APNS'] as const) {
        await expect(service.registerToken('u1', { token: TOKEN, provider })).rejects.toMatchObject({
          errorCode: 'UNSUPPORTED_PUSH_PROVIDER',
        });
      }
      expect(tokens.register).not.toHaveBeenCalled();
    });

    it('rejects an unknown user', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.registerToken('ghost', { token: TOKEN })).rejects.toMatchObject({
        errorCode: 'USER_NOT_FOUND',
      });
    });
  });

  describe('removeToken', () => {
    it('reports whether a token was removed, without failing for an unknown token', async () => {
      expect(await service.removeToken('u1', TOKEN)).toEqual({ removed: true });

      tokens.remove.mockResolvedValue(false);
      expect(await service.removeToken('u1', TOKEN)).toEqual({ removed: false });
      expect(tokens.remove).toHaveBeenCalledWith('u1', TOKEN);
    });
  });

  describe('settings', () => {
    it('returns the settings, on by default', async () => {
      expect(await service.getSettings('u1')).toEqual({ monthlySettlement: true });
    });

    it('changes only the given setting', async () => {
      expect(await service.updateSettings('u1', { monthlySettlement: false })).toEqual({
        monthlySettlement: false,
      });
      expect(settings.update).toHaveBeenCalledWith('u1', { monthlySettlement: false });
    });

    it('rejects an update with nothing to change', async () => {
      await expect(service.updateSettings('u1', {})).rejects.toMatchObject({
        errorCode: 'INVALID_REQUEST_PAYLOAD',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(settings.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown user', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.getSettings('ghost')).rejects.toMatchObject({ errorCode: 'USER_NOT_FOUND' });
      await expect(service.updateSettings('ghost', { monthlySettlement: true })).rejects.toMatchObject({
        errorCode: 'USER_NOT_FOUND',
      });
    });
  });
});
