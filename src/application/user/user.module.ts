import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { AuthModule } from '../../infra/auth/auth.module';
import { UserController } from './user.controller';
import { UserPlaceService } from './user-place.service';
import { UserService } from './user.service';

@Module({
  imports: [AuthModule, SubwayModule],
  controllers: [UserController],
  providers: [UserService, UserPlaceService],
})
export class UserModule {}
