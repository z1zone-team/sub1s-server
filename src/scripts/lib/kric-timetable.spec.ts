import {
  KricTimetableRow,
  analyzeTimetableDurations,
  calculateDurationSec,
  calculateMedian,
  parseTimeToSeconds,
} from './kric-timetable';

describe('kric-timetable', () => {
  describe('parseTimeToSeconds', () => {
    it('parses valid HHMMSS strings into seconds since midnight', () => {
      expect(parseTimeToSeconds('000000')).toBe(0);
      expect(parseTimeToSeconds('010000')).toBe(3600);
      expect(parseTimeToSeconds('054500')).toBe(5 * 3600 + 45 * 60);
      expect(parseTimeToSeconds('235959')).toBe(23 * 3600 + 59 * 60 + 59);
    });

    it('returns null for null, undefined, or malformed strings', () => {
      expect(parseTimeToSeconds(null)).toBeNull();
      expect(parseTimeToSeconds(undefined)).toBeNull();
      expect(parseTimeToSeconds('')).toBeNull();
      expect(parseTimeToSeconds('12345')).toBeNull();
      expect(parseTimeToSeconds('1234567')).toBeNull();
      expect(parseTimeToSeconds('abcdef')).toBeNull();
      expect(parseTimeToSeconds('246060')).toBeNull(); // 60 minutes is invalid
    });
  });

  describe('calculateDurationSec', () => {
    it('calculates duration between departure and arrival on same day', () => {
      // 05:45:00 departure -> 05:51:30 arrival = 6.5 minutes = 390 seconds
      expect(calculateDurationSec('054500', '055130')).toBe(390);
    });

    it('handles midnight wrap-around seamlessly', () => {
      // 23:58:30 departure -> 00:02:30 arrival = 4 minutes = 240 seconds
      expect(calculateDurationSec('235830', '000230')).toBe(240);
    });

    it('returns null if departure or arrival is null or invalid', () => {
      expect(calculateDurationSec(null, '055130')).toBeNull();
      expect(calculateDurationSec('054500', null)).toBeNull();
    });

    it('returns null if duration is zero, negative without wrap, or exceeds 1 hour', () => {
      expect(calculateDurationSec('055000', '055000')).toBeNull(); // 0 seconds
      expect(calculateDurationSec('050000', '070000')).toBeNull(); // 2 hours
    });
  });

  describe('calculateMedian', () => {
    it('returns 0 for empty array', () => {
      expect(calculateMedian([])).toBe(0);
    });

    it('returns middle element for odd length arrays', () => {
      expect(calculateMedian([100, 390, 500])).toBe(390);
    });

    it('returns rounded average of two middle elements for even length arrays', () => {
      expect(calculateMedian([380, 390, 400, 410])).toBe(395);
    });
  });

  describe('analyzeTimetableDurations', () => {
    const mockRows: KricTimetableRow[] = [
      // Train 1: regular train A -> B -> C
      {
        railOprIsttCd: 'GX',
        trnNo: 'X0001',
        dayCd: '8',
        stinCd: 'X108',
        lnCd: 'A',
        arvTm: null,
        dptTm: '054500',
        exptCd: null,
      },
      {
        railOprIsttCd: 'GX',
        trnNo: 'X0001',
        dayCd: '8',
        stinCd: 'X109',
        lnCd: 'A',
        arvTm: '055130',
        dptTm: '055200',
        exptCd: null,
      },
      {
        railOprIsttCd: 'GX',
        trnNo: 'X0001',
        dayCd: '8',
        stinCd: 'X110',
        lnCd: 'A',
        arvTm: '060000',
        dptTm: null,
        exptCd: null,
      },
      // Train 2: regular train A -> B -> C with slight rush hour variance
      {
        railOprIsttCd: 'GX',
        trnNo: 'X0002',
        dayCd: '8',
        stinCd: 'X108',
        lnCd: 'A',
        arvTm: null,
        dptTm: '060000',
        exptCd: null,
      },
      {
        railOprIsttCd: 'GX',
        trnNo: 'X0002',
        dayCd: '8',
        stinCd: 'X109',
        lnCd: 'A',
        arvTm: '060640',
        dptTm: '060710',
        exptCd: null,
      },
      {
        railOprIsttCd: 'GX',
        trnNo: 'X0002',
        dayCd: '8',
        stinCd: 'X110',
        lnCd: 'A',
        arvTm: '061520',
        dptTm: null,
        exptCd: null,
      },
      // Train 3: express train A -> C (skipping B)
      {
        railOprIsttCd: 'GX',
        trnNo: 'X9001',
        dayCd: '8',
        stinCd: 'X108',
        lnCd: 'A',
        arvTm: null,
        dptTm: '070000',
        exptCd: '1',
      },
      {
        railOprIsttCd: 'GX',
        trnNo: 'X9001',
        dayCd: '8',
        stinCd: 'X110',
        lnCd: 'A',
        arvTm: '071100',
        dptTm: null,
        exptCd: '1',
      },
    ];

    it('correctly aggregates inter-station durations with median for regular and express', () => {
      const results = analyzeTimetableDurations(mockRows);

      // Should have:
      // X108 -> X109 (regular, samples: 390s, 400s -> median: 395s)
      // X109 -> X110 (regular, samples: 480s, 490s -> median: 485s)
      // X108 -> X110 (express, sample: 660s)
      expect(results).toHaveLength(3);

      const regAB = results.find(
        (r) => r.fromStinCd === 'X108' && r.toStinCd === 'X109' && !r.isExpress,
      );
      expect(regAB).toBeDefined();
      expect(regAB?.sampleCount).toBe(2);
      expect(regAB?.durationSec).toBe(395);
      expect(regAB?.minDurationSec).toBe(390);
      expect(regAB?.maxDurationSec).toBe(400);

      const regBC = results.find(
        (r) => r.fromStinCd === 'X109' && r.toStinCd === 'X110' && !r.isExpress,
      );
      expect(regBC).toBeDefined();
      expect(regBC?.sampleCount).toBe(2);
      expect(regBC?.durationSec).toBe(485);

      const expAC = results.find(
        (r) => r.fromStinCd === 'X108' && r.toStinCd === 'X110' && r.isExpress,
      );
      expect(expAC).toBeDefined();
      expect(expAC?.sampleCount).toBe(1);
      expect(expAC?.durationSec).toBe(660);
      expect(expAC?.isExpress).toBe(true);
    });
  });
});
