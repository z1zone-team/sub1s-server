/**
 * Determines whether a given car on a line is a weak air-conditioned car.
 * Reference: Seoul Metro standards (Lines 1, 3, 4: cars 4, 7; Lines 5, 6, 7: cars 4, 5; Line 8: cars 3, 4)
 */
export function isWeakAirConditioned(lineId: string, carNo: number): boolean {
  switch (lineId) {
    case '01':
    case '03':
    case '04':
    case '1':
    case '3':
    case '4':
      return carNo === 4 || carNo === 7;
    case '05':
    case '06':
    case '07':
    case '5':
    case '6':
    case '7':
      return carNo === 4 || carNo === 5;
    case '08':
    case '8':
      return carNo === 3 || carNo === 4;
    default:
      return false;
  }
}
