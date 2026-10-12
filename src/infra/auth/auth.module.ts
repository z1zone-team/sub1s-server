import { Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { ClerkTokenService } from './clerk-token.service';
import { MockAuthGuard } from './mock-auth.guard';
import { OptionalClerkAuthGuard } from './optional-clerk-auth.guard';

@Module({
  providers: [
    ClerkAuthGuard,
    OptionalClerkAuthGuard,
    ClerkTokenService,
    MockAuthGuard,
  ],
  exports: [
    ClerkAuthGuard,
    OptionalClerkAuthGuard,
    ClerkTokenService,
    MockAuthGuard,
  ],
})
export class AuthModule {}

