import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { RouteMode } from '../../../domain/subway/models/route';

export class RouteSearchRequestDto {
  @IsNotEmpty()
  @IsString()
  originStationId!: string;

  @IsNotEmpty()
  @IsString()
  destinationStationId!: string;

  @IsOptional()
  @IsIn(['OPTIMAL', 'COMFORTABLE', 'PERSONAL', 'CHEAPEST'])
  routeMode?: RouteMode;

  @IsOptional()
  @IsISO8601()
  departureAt?: string;
}
