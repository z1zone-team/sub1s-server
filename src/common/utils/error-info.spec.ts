import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception';
import { toErrorInfo } from './error-info';

describe('toErrorInfo', () => {
  it('BusinessException은 코드와 메시지, 상태를 그대로 쓴다', () => {
    const info = toErrorInfo(
      new BusinessException(
        'VOICE_ORIGIN_REQUIRED',
        '출발지를 말씀해 주세요.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { field: 'origin' },
      ),
    );

    expect(info).toEqual({
      status: 422,
      code: 'VOICE_ORIGIN_REQUIRED',
      message: '출발지를 말씀해 주세요.',
      details: { field: 'origin' },
      unexpected: false,
    });
  });

  it('코드가 없는 HttpException은 상태로 코드를 정한다', () => {
    expect(toErrorInfo(new BadRequestException('잘못된 요청')).code).toBe(
      'INVALID_REQUEST_PAYLOAD',
    );
    expect(toErrorInfo(new UnauthorizedException()).code).toBe('UNAUTHORIZED');
    expect(toErrorInfo(new NotFoundException('없어요')).code).toBe('HTTP_ERROR');
  });

  it('검증 오류처럼 메시지가 배열이면 쉼표로 이어 붙인다', () => {
    const info = toErrorInfo(
      new BadRequestException({ message: ['a는 필수', 'b는 숫자'] }),
    );

    expect(info.message).toBe('a는 필수, b는 숫자');
    expect(info.status).toBe(400);
  });

  it('문자열 응답의 HttpException은 그 문자열이 메시지다', () => {
    const info = toErrorInfo(
      new HttpException('잠시만 기다려주세요.', HttpStatus.TOO_MANY_REQUESTS),
    );

    expect(info).toMatchObject({
      status: 429,
      code: 'HTTP_ERROR',
      message: '잠시만 기다려주세요.',
      unexpected: false,
    });
  });

  it('예상하지 못한 오류는 500이고 내부 내용을 드러내지 않는다', () => {
    const info = toErrorInfo(new Error('db password is hunter2'));

    expect(info).toEqual({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
      unexpected: true,
    });
  });
});
