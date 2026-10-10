export const SUBWAY_LINE_REPOSITORY = Symbol('SUBWAY_LINE_REPOSITORY');

export interface SubwayLineRecord {
  id: string;
  lineName: string;
  colorHex: string;
}

export interface ISubwayLineRepository {
  findAll(): Promise<SubwayLineRecord[]>;
}
