import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { MockAuthGuard } from './mock-auth.guard';

@Module({
  imports: [DatabaseModule],
  providers: [ClerkAuthGuard, MockAuthGuard],
  exports: [ClerkAuthGuard, MockAuthGuard],
})
export class AuthModule {}

