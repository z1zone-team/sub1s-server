import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { SubwayRouteOptionDto } from '../../route/dto/route-search-response.dto';

export class StartTrackingRequestDto {
  @IsObject()
  @IsNotEmpty()
  routeOption!: SubwayRouteOptionDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  stationIds?: string[];
}
