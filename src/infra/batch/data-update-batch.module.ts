import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataUpdateBatchService } from './data-update-batch.service';

@Module({
  imports: [ConfigModule],
  providers: [DataUpdateBatchService],
  exports: [DataUpdateBatchService],
})
export class DataUpdateBatchModule {}
