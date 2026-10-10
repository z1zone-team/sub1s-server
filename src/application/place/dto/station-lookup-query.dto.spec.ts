import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StationLookupQueryDto } from './station-lookup-query.dto';

describe('StationLookupQueryDto', () => {
  const parse = (ids: unknown) => {
    const dto = plainToInstance(StationLookupQueryDto, { ids });
    return { dto, errors: validateSync(dto) };
  };

  it('splits a comma separated string and trims blanks', () => {
    const { dto, errors } = parse(' 02_222, 09_925 ,,');

    expect(errors).toHaveLength(0);
    expect(dto.ids).toEqual(['02_222', '09_925']);
  });

  it('accepts a single id', () => {
    const { dto, errors } = parse('02_222');

    expect(errors).toHaveLength(0);
    expect(dto.ids).toEqual(['02_222']);
  });

  it('rejects a missing or empty ids value', () => {
    expect(parse(undefined).errors).not.toHaveLength(0);
    expect(parse('').errors).not.toHaveLength(0);
    expect(parse(' , ').errors).not.toHaveLength(0);
  });

  it('accepts 20 ids and rejects 21', () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => `ID_${i}`).join(',');

    expect(parse(ids(20)).errors).toHaveLength(0);
    expect(parse(ids(21)).errors).not.toHaveLength(0);
  });
});
