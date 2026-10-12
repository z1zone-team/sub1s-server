import { Module } from '@nestjs/common';
import { AuthModule as InfraAuthModule } from '../../infra/auth/auth.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [InfraAuthModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
