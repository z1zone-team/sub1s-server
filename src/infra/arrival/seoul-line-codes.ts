import { TrainDirection } from '../../domain/arrival/ports/INextTrainProvider';

export const SEOUL_SUBWAY_IDS: Readonly<Record<string, string>> = {
  '01': '1001',
  '02': '1002',
  '03': '1003',
  '04': '1004',
  '05': '1005',
  '06': '1006',
  '07': '1007',
  '08': '1008',
  '09': '1009',
  GJ: '1063',
  AR: '1065',
  GC: '1067',
  SD: '1075',
  SB: '1077',
  UI: '1092',
  GA: '1032',
};

export const SEOUL_DIRECTIONS: Readonly<Record<string, TrainDirection>> = {
  상행: 'UP',
  하행: 'DOWN',
  내선: 'INNER',
  외선: 'OUTER',
};
