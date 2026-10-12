import { Module } from '@nestjs/common';
import { OPERATION_NOTICE_PROVIDER } from '../../domain/operation/ports/IOperationNoticeProvider';
import { SubwayModule } from '../../domain/subway/subway.module';
import { DataGoKrNoticeProvider } from '../../infra/operation/data-go-kr-notice.provider';
import { AuthModule as InfraAuthModule } from '../../infra/auth/auth.module';
import { RoutingModule } from '../../infra/routing/routing.module';
import { RouteController } from './route.controller';
import { OperationStatusService } from './operation-status.service';
import { RouteService } from './route.service';

@Module({
  imports: [SubwayModule, RoutingModule, InfraAuthModule],
  controllers: [RouteController],
  providers: [
    RouteService,
    OperationStatusService,
    { provide: OPERATION_NOTICE_PROVIDER, useClass: DataGoKrNoticeProvider },
  ],
  exports: [RouteService],
})
export class RouteModule {}
