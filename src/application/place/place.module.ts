import { Module } from '@nestjs/common';
import { PLACE_SEARCH_PROVIDER } from '../../domain/place/ports/IPlaceSearchProvider';
import { SubwayModule } from '../../domain/subway/subway.module';
import { VWorldPlaceProvider } from '../../infra/place/vworld-place.provider';
import { PlaceController } from './place.controller';
import { PlaceService } from './place.service';
import { StationController } from './station.controller';

@Module({
  imports: [SubwayModule],
  controllers: [PlaceController, StationController],
  providers: [
    PlaceService,
    { provide: PLACE_SEARCH_PROVIDER, useClass: VWorldPlaceProvider },
  ],
})
export class PlaceModule {}
