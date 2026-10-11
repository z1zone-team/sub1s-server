import { OperationNotice } from '../models/operation-status';

export const OPERATION_NOTICE_PROVIDER = Symbol('OPERATION_NOTICE_PROVIDER');

export interface IOperationNoticeProvider {
  /** 최근 공지. 가져오지 못했으면 null이며 이때 운행 상태는 모두 UNKNOWN이다. 던지지 않는다 */
  fetchRecentNotices(): Promise<OperationNotice[] | null>;
}
