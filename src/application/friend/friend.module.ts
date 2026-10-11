import { Module } from '@nestjs/common';
import { AuthModule } from '../../infra/auth/auth.module';
import { FriendController } from './friend.controller';
import { FriendService } from './friend.service';

@Module({
  imports: [AuthModule],
  controllers: [FriendController],
  providers: [FriendService],
})
export class FriendModule {}
