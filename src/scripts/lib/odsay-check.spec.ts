import {
  OdsayPath,
  adjacencyKey,
  checkTopology,
  summarize,
} from './odsay-check';

const path: OdsayPath = {
  info: { payment: 1550, totalTime: 20 },
  subPath: [
    { trafficType: 3 },
    {
      trafficType: 1,
      lane: [{ name: '수도권 5호선' }],
      passStopList: {
        stations: [{ stationName: '강동' }, { stationName: '둔촌동' }],
      },
    },
    {
      trafficType: 1,
      lane: [{ name: '수도권 9호선' }],
      passStopList: {
        stations: [{ stationName: '둔촌오륜' }, { stationName: '올림픽공원' }],
      },
    },
  ],
};

describe('summarize', () => {
  it('keeps subway rides only and counts transfers', () => {
    const summary = summarize(path);
    expect(summary.rides).toHaveLength(2);
    expect(summary.transfers).toBe(1);
    expect(summary.fare).toBe(1550);
    expect(summary.rides[0].stations).toEqual(['강동', '둔촌동']);
  });
});

describe('checkTopology', () => {
  const known = new Set(['강동', '둔촌동', '둔촌오륜', '올림픽공원']);

  it('passes when every consecutive pair is a link', () => {
    const links = new Set([
      adjacencyKey('강동', '둔촌동'),
      adjacencyKey('올림픽공원', '둔촌오륜'),
    ]);
    const verdict = checkTopology(summarize(path), known, links);
    expect(verdict.brokenLinks).toEqual([]);
    expect(verdict.unknownStations).toEqual([]);
  });

  it('reports missing links and unknown stations', () => {
    const verdict = checkTopology(
      summarize(path),
      new Set(['강동']),
      new Set(),
    );
    expect(verdict.brokenLinks).toEqual(['강동-둔촌동', '둔촌오륜-올림픽공원']);
    expect(verdict.unknownStations).toContain('둔촌동');
  });
});
