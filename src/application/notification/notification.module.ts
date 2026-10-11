import { Module } from '@nestjs/common';
import { PUSH_SENDER } from '../../domain/notification/ports/notification-ports';
import { AuthModule } from '../../infra/auth/auth.module';
import { ExpoPushSender } from '../../infra/notification/expo-push.sender';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { SettlementScheduler } from './settlement.scheduler';
import { SettlementService } from './settlement.service';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    SettlementService,
    SettlementScheduler,
    { provide: PUSH_SENDER, useClass: ExpoPushSender },
  ],
})
export class NotificationModule {}
