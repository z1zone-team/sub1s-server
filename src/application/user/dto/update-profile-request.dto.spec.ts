import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileRequestDto } from './update-profile-request.dto';

describe('UpdateProfileRequestDto', () => {
  const parse = (body: Record<string, unknown>) => {
    const dto = plainToInstance(UpdateProfileRequestDto, body);
    return { dto, errors: validateSync(dto) };
  };

  it('accepts any single field', () => {
    expect(parse({ name: '박지훈' }).errors).toHaveLength(0);
    expect(parse({ nickname: '내출신은리' }).errors).toHaveLength(0);
    expect(parse({ rankingVisibility: 'PRIVATE' }).errors).toHaveLength(0);
    expect(parse({}).errors).toHaveLength(0);
  });

  it('accepts null for the name and keeps it null', () => {
    const { dto, errors } = parse({ name: null });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBeNull();
  });

  it('trims and normalizes name and nickname', () => {
    const { dto, errors } = parse({ name: '  박지훈 ', nickname: ` ${'한글'.normalize('NFD')} ` });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('박지훈');
    expect(dto.nickname).toBe('한글');
  });

  it.each(['', '   ', 'x'.repeat(31), 123])('rejects the name %j', (name) => {
    expect(parse({ name }).errors).not.toHaveLength(0);
  });

  it.each(['a', 'x'.repeat(21), '내 출신', 'a@b', '', 5])('rejects the nickname %j', (nickname) => {
    expect(parse({ nickname }).errors).not.toHaveLength(0);
  });

  it.each(['PUBLIC', 'ANONYMOUS', 'PRIVATE'])('accepts the visibility %s', (rankingVisibility) => {
    expect(parse({ rankingVisibility }).errors).toHaveLength(0);
  });

  it.each(['public', 'FRIENDS', true, 1])('rejects the visibility %j', (rankingVisibility) => {
    expect(parse({ rankingVisibility }).errors).not.toHaveLength(0);
  });
});
