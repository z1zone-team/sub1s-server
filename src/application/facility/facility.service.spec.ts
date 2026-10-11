import { HttpStatus } from '@nestjs/common';
import { StationFacilities } from '../../domain/facility/models/station-facilities';
import { IStationFacilityRepository } from '../../domain/facility/ports/IStationFacilityRepository';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { FacilityService } from './facility.service';

describe('FacilityService', () => {
  const data: Record<string, StationFacilities> = {
    '02_222': {
      exits: [{ exitNo: '1', facilities: [{ name: '은행', address: null }] }],
      elevatorDoors: ['3-4', '8-1'],
    },
    '01_147': { exits: [], elevatorDoors: [] },
  };
  const repository: IStationFacilityRepository = { findByStationId: (id) => data[id] };
  const stations: Record<string, { lineId: string; stationName: string }> = {
    '02_222': { lineId: '02', stationName: '강남' },
    '01_147': { lineId: '01', stationName: '소사' },
    '09_925': { lineId: '09', stationName: '신논현' },
  };
  const ids = Object.keys(stations);
  const graph = {
    indexOf: (id: string) => (ids.includes(id) ? ids.indexOf(id) : undefined),
    station: (index: number) => ({ id: ids[index], ...stations[ids[index]] }),
  };
  const service = new FacilityService(repository, {
    getGraph: () => graph,
  } as unknown as SubwayGraphService);

  it('returns the exits and the elevator doors of a station with data', () => {
    expect(service.getFacilities('02_222')).toEqual({
      stationId: '02_222',
      stationName: '강남',
      lineId: '02',
      available: true,
      hasElevator: true,
      elevatorDoors: ['3-4', '8-1'],
      exits: [{ exitNo: '1', facilities: [{ name: '은행', address: null }] }],
    });
  });

  it('says there is no elevator when the data exists but has no elevator door', () => {
    expect(service.getFacilities('01_147')).toMatchObject({
      available: true,
      hasElevator: false,
      elevatorDoors: [],
      exits: [],
    });
  });

  it('marks a station without data as unavailable and the elevator as unknown', () => {
    expect(service.getFacilities('09_925')).toEqual({
      stationId: '09_925',
      stationName: '신논현',
      lineId: '09',
      available: false,
      hasElevator: null,
      elevatorDoors: [],
      exits: [],
    });
  });

  it('rejects an unknown station with 404', () => {
    expect(() => service.getFacilities('99_999')).toThrow(
      expect.objectContaining({ errorCode: 'STATION_NOT_FOUND', status: HttpStatus.NOT_FOUND }),
    );
  });
});
