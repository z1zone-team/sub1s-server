import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { MockAuthGuard } from './mock-auth.guard';

@Module({
  imports: [PrismaModule],
  providers: [ClerkAuthGuard, MockAuthGuard],
  exports: [ClerkAuthGuard, MockAuthGuard],
})
export class AuthModule {}

