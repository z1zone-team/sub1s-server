import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdatePreferencesRequestDto } from './preferences.dto';

describe('UpdatePreferencesRequestDto', () => {
  const parse = (body: Record<string, unknown>) => {
    const dto = plainToInstance(UpdatePreferencesRequestDto, body);
    return { dto, errors: validateSync(dto) };
  };

  it('accepts one or more allowed values for each step', () => {
    const { errors } = parse({
      purposes: ['COMMUTE', 'DATE'],
      routePrefs: ['FAST', 'ELEVATOR'],
    });

    expect(errors).toHaveLength(0);
  });

  it('removes duplicates and keeps the order', () => {
    const { dto, errors } = parse({
      purposes: ['DATE', 'COMMUTE', 'DATE'],
      routePrefs: ['FAST', 'FAST'],
    });

    expect(errors).toHaveLength(0);
    expect(dto.purposes).toEqual(['DATE', 'COMMUTE']);
    expect(dto.routePrefs).toEqual(['FAST']);
  });

  it.each([
    ['empty purposes', { purposes: [], routePrefs: ['FAST'] }],
    ['empty routePrefs', { purposes: ['COMMUTE'], routePrefs: [] }],
    ['missing routePrefs', { purposes: ['COMMUTE'] }],
    ['missing purposes', { routePrefs: ['FAST'] }],
    ['unknown purpose', { purposes: ['출퇴근'], routePrefs: ['FAST'] }],
    ['unknown routePref', { purposes: ['COMMUTE'], routePrefs: ['FASTEST'] }],
    ['a string instead of an array', { purposes: 'COMMUTE', routePrefs: ['FAST'] }],
  ])('rejects %s', (_name, body) => {
    expect(parse(body).errors.length).toBeGreaterThan(0);
  });
});
