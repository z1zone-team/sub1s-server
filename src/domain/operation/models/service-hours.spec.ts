import { ScheduleGroup } from '../../arrival/models/train-schedule';
import { checkBoarding, serviceWindowOf } from './service-hours';

describe('service-hours', () => {
  const groups: ScheduleGroup[] = [
    ['INNER', '성수', 0, [20160, 30000, 86010]],
    ['INNER', '신도림', 0, [31560, 88410]],
    ['OUTER', '성수', 0, [20670, 88680]],
  ];

  describe('serviceWindowOf', () => {
    it('picks the earliest and latest train of the direction across destinations', () => {
      expect(serviceWindowOf(groups, 'INNER')).toEqual({ firstTrainSec: 20160, lastTrainSec: 88410 });
      expect(serviceWindowOf(groups, 'OUTER')).toEqual({ firstTrainSec: 20670, lastTrainSec: 88680 });
    });

    it('returns null when the direction has no trains or no schedule exists', () => {
      expect(serviceWindowOf(groups, 'UP')).toBeNull();
      expect(serviceWindowOf(undefined, 'INNER')).toBeNull();
      expect(serviceWindowOf([['INNER', '성수', 0, []]], 'INNER')).toBeNull();
    });
  });

  describe('checkBoarding', () => {
    const window = { firstTrainSec: 20160, lastTrainSec: 88410 };

    it('is null while trains are running, including the first and last train times', () => {
      expect(checkBoarding(window, 20160)).toBeNull();
      expect(checkBoarding(window, 40000)).toBeNull();
      expect(checkBoarding(window, 88410)).toBeNull();
    });

    it('flags arrival before the first train and after the last train', () => {
      expect(checkBoarding(window, 20159)).toBe('BEFORE_FIRST_TRAIN');
      expect(checkBoarding(window, 88411)).toBe('AFTER_LAST_TRAIN');
    });
  });
});
