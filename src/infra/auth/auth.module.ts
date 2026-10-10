import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { ClerkTokenService } from './clerk-token.service';
import { MockAuthGuard } from './mock-auth.guard';

@Module({
  imports: [DatabaseModule],
  providers: [ClerkAuthGuard, ClerkTokenService, MockAuthGuard],
  exports: [ClerkAuthGuard, ClerkTokenService, MockAuthGuard],
})
export class AuthModule {}

