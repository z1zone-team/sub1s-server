import { Module } from '@nestjs/common';
import { STATION_FACILITY_REPOSITORY } from '../../domain/facility/ports/IStationFacilityRepository';
import { SubwayModule } from '../../domain/subway/subway.module';
import { FileStationFacilityRepository } from '../../infra/facility/file-station-facility.repository';
import { FacilityController } from './facility.controller';
import { FacilityService } from './facility.service';

@Module({
  imports: [SubwayModule],
  controllers: [FacilityController],
  providers: [
    FacilityService,
    {
      provide: STATION_FACILITY_REPOSITORY,
      useClass: FileStationFacilityRepository,
    },
  ],
})
export class FacilityModule {}
