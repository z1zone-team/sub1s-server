import { classifyAddressQuery } from './address-query';

describe('classifyAddressQuery', () => {
  it.each([
    '문화로 67-1',
    '경기도 광주시 문화로 67-1',
    '허준로 95-5',
    '세종대로 110',
    '양천로59길 38',
    '테헤란로152',
    '서울특별시 강서구 허준로 95-5',
  ])('도로명 주소 `%s`', (query) => {
    expect(classifyAddressQuery(query)).toBe('ROAD');
  });

  it.each(['가양동 1460', '경안동 167-42', '서울 강서구 가양동 1460', '종로3가 12'])(
    '지번 주소 `%s`',
    (query) => {
      expect(classifyAddressQuery(query)).toBe('PARCEL');
    },
  );

  it.each(['67-1', '67', ' 12 - 3 '])('번지만 있는 입력 `%s`', (query) => {
    expect(classifyAddressQuery(query)).toBe('NUMBER_ONLY');
  });

  it.each([
    '서울시청',
    '가양동',
    '문화로',
    '강남역 2번출구',
    '을지로3가',
    '을지로4가역',
    '롯데월드',
    '1호선',
  ])('주소가 아닌 입력 `%s`', (query) => {
    expect(classifyAddressQuery(query)).toBe('PLACE');
  });

  it('도로명과 지번이 함께 있으면 도로명을 우선한다', () => {
    expect(classifyAddressQuery('경안동 문화로 67-1')).toBe('ROAD');
  });
});
