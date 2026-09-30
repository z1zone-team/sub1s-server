import { GraphData } from '../models/subway-graph';
import { ISubwayGraphRepository } from '../ports/ISubwayGraphRepository';
import { SubwayGraphService } from './subway-graph.service';

const data: GraphData = {
  stations: [
    {
      id: 'T_A',
      lineId: 'T',
      stationName: '가',
      lat: 37,
      lng: 127,
      lineSeq: 1,
    },
  ],
  edges: [],
  transfers: [],
};

describe('SubwayGraphService', () => {
  it('builds the graph once on module init', async () => {
    const loadGraphData = jest.fn().mockResolvedValue(data);
    const repository: ISubwayGraphRepository = { loadGraphData };
    const service = new SubwayGraphService(repository);

    await service.onModuleInit();

    expect(loadGraphData).toHaveBeenCalledTimes(1);
    expect(service.getGraph().stationCount).toBe(1);
    expect(service.getGraph()).toBe(service.getGraph());
  });

  it('throws when the graph is requested before it is loaded', () => {
    const repository: ISubwayGraphRepository = { loadGraphData: jest.fn() };
    expect(() => new SubwayGraphService(repository).getGraph()).toThrow(
      'not loaded',
    );
  });
});
