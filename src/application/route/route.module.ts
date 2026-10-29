import { Module } from '@nestjs/common';
import { OPERATION_NOTICE_PROVIDER } from '../../domain/operation/ports/IOperationNoticeProvider';
import { SubwayModule } from '../../domain/subway/subway.module';
import { WALK_ROUTE_PROVIDER } from '../../domain/subway/ports/IWalkRouteProvider';
import { DataGoKrNoticeProvider } from '../../infra/operation/data-go-kr-notice.provider';
import { OsrmWalkRouteProvider } from '../../infra/walking/osrm-walk-route.provider';
import { AuthModule as InfraAuthModule } from '../../infra/auth/auth.module';
import { RoutingModule } from '../../infra/routing/routing.module';
import { ArrivalModule } from '../arrival/arrival.module';
import { FacilityModule } from '../facility/facility.module';
import { RouteController } from './route.controller';
import { OperationStatusService } from './operation-status.service';
import { ServiceHoursService } from './service-hours.service';
import { TrackPathService } from './track-path.service';
import { RouteService } from './route.service';
import { PreferenceModelService } from './preference-model.service';

@Module({
  imports: [SubwayModule, RoutingModule, InfraAuthModule, ArrivalModule, FacilityModule],
  controllers: [RouteController],
  providers: [
    RouteService,
    PreferenceModelService,
    OperationStatusService,
    ServiceHoursService,
    TrackPathService,
    { provide: OPERATION_NOTICE_PROVIDER, useClass: DataGoKrNoticeProvider },
    { provide: WALK_ROUTE_PROVIDER, useClass: OsrmWalkRouteProvider },
  ],
  exports: [RouteService],
})
export class RouteModule {}
