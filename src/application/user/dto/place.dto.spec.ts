import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PlaceKindParamDto, SavePlaceRequestDto } from './place.dto';

describe('SavePlaceRequestDto', () => {
  const parse = (body: Record<string, unknown>) => {
    const dto = plainToInstance(SavePlaceRequestDto, body);
    return { dto, errors: validateSync(dto) };
  };

  it('accepts a station place', () => {
    expect(parse({ name: '가양역', stationId: '09_907' }).errors).toHaveLength(0);
  });

  it('accepts a coordinate place', () => {
    expect(parse({ name: '우리집', lat: 37.5, lng: 127.0 }).errors).toHaveLength(0);
  });

  it('trims the name', () => {
    expect(parse({ name: '  가양역  ', stationId: '09_907' }).dto.name).toBe('가양역');
  });

  it.each([
    ['blank name', { name: '   ', stationId: '09_907' }],
    ['missing name', { stationId: '09_907' }],
    ['name over 100 characters', { name: 'a'.repeat(101), stationId: '09_907' }],
    ['lat without lng', { name: '집', lat: 37.5 }],
    ['lng without lat', { name: '집', lng: 127 }],
    ['latitude out of range', { name: '집', lat: 91, lng: 127 }],
    ['longitude out of range', { name: '집', lat: 37, lng: 181 }],
    ['non-numeric coordinates', { name: '집', lat: 'a', lng: 'b' }],
    ['empty station id', { name: '집', stationId: '' }],
  ])('rejects %s', (_name, body) => {
    expect(parse(body).errors.length).toBeGreaterThan(0);
  });
});

describe('PlaceKindParamDto', () => {
  const errorsOf = (kind: unknown) =>
    validateSync(plainToInstance(PlaceKindParamDto, { kind }));

  it('accepts HOME and SCHOOL only', () => {
    expect(errorsOf('HOME')).toHaveLength(0);
    expect(errorsOf('SCHOOL')).toHaveLength(0);
    expect(errorsOf('OFFICE').length).toBeGreaterThan(0);
    expect(errorsOf('home').length).toBeGreaterThan(0);
  });
});
