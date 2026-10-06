import { Module } from '@nestjs/common';
import { AuthModule } from '../../infra/auth/auth.module';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RankingController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
