export const HOLIDAY_CALENDAR = Symbol('HOLIDAY_CALENDAR');

export interface IHolidayCalendar {
  /** dayKey는 KST 날짜 'YYYY-MM-DD'. 알 수 없으면 false */
  isPublicHoliday(dayKey: string): Promise<boolean>;
}
