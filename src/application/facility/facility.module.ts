import { Module } from '@nestjs/common';
import { STATION_FACILITY_REPOSITORY } from '../../domain/facility/ports/IStationFacilityRepository';
import { STATION_VERTICAL_REPOSITORY } from '../../domain/facility/ports/IStationVerticalRepository';
import { SubwayModule } from '../../domain/subway/subway.module';
import { FileStationFacilityRepository } from '../../infra/facility/file-station-facility.repository';
import { FileStationVerticalRepository } from '../../infra/facility/file-station-vertical.repository';
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
    {
      provide: STATION_VERTICAL_REPOSITORY,
      useClass: FileStationVerticalRepository,
    },
  ],
  exports: [STATION_FACILITY_REPOSITORY, STATION_VERTICAL_REPOSITORY],
})
export class FacilityModule {}
