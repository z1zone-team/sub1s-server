import { Module } from '@nestjs/common';
import { AuthModule } from '../../infra/auth/auth.module';
import { DatabaseModule } from '../../infra/database/database.module';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RankingController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
