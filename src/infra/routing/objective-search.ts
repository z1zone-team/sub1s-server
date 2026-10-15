import {
  RouteMode,
  RouteNotFoundError,
  RouteResult,
} from '../../domain/subway/models/route';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';

export interface ObjectiveStep {
  from: number;
  link: number;
  isTransfer: boolean;
}
type Cost = readonly [number, number];
const compare = (a: Cost, b: Cost): number => a[0] - b[0] || a[1] - b[1];

/** Exact primary/time objectives; retain every tied prefix until whole-route fares are known. */
export function objectiveSearch(
  graph: SubwayGraph,
  origin: number,
  destination: number,
  mode: RouteMode,
  materialize: (steps: ObjectiveStep[]) => RouteResult,
  blockedPairs?: Set<number>,
  stats?: { visitedNodes: number; relaxedEdges: number },
): RouteResult {
  // Track whether a ride has occurred and whether walking separates two rides.
  const stateCount = mode === 'FEWEST_TRANSFERS' ? 3 : 1;
  const start = origin * stateCount;
  const targetStates = Array.from(
    { length: stateCount },
    (_, state) => destination * stateCount + state,
  );
  const destinationCost = (): Cost =>
    targetStates.map((state) => costs[state]).sort(compare)[0];
  const costs: Cost[] = Array.from(
    { length: graph.stationCount * stateCount },
    () => [Infinity, Infinity],
  );
  const previous: Array<Array<ObjectiveStep & { previousState: number }>> =
    Array.from({ length: graph.stationCount * stateCount }, () => []);
  const queue: Array<{ node: number; cost: Cost }> = [];
  const push = (node: number, cost: Cost): void => {
    let child = queue.length;
    queue.push({ node, cost });
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (compare(queue[parent].cost, cost) <= 0) break;
      queue[child] = queue[parent];
      child = parent;
    }
    queue[child] = { node, cost };
  };
  const pop = (): { node: number; cost: Cost } => {
    const top = queue[0];
    const last = queue.pop()!;
    if (queue.length) {
      let parent = 0;
      while (parent * 2 + 1 < queue.length) {
        let child = parent * 2 + 1;
        if (
          child + 1 < queue.length &&
          compare(queue[child + 1].cost, queue[child].cost) < 0
        )
          child++;
        if (compare(last.cost, queue[child].cost) <= 0) break;
        queue[parent] = queue[child];
        parent = child;
      }
      queue[parent] = last;
    }
    return top;
  };
  costs[start] = [0, 0];
  push(start, costs[start]);
  while (queue.length) {
    const current = pop();
    if (compare(current.cost, costs[current.node]) !== 0) continue;
    if (compare(current.cost, destinationCost()) > 0) break;
    if (stats) stats.visitedNodes++;
    const node = Math.floor(current.node / stateCount);
    const state = current.node % stateCount;
    const relax = (
      to: number,
      seconds: number,
      primary: number,
      step: ObjectiveStep,
    ): void => {
      if (
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        !Number.isFinite(primary) ||
        primary < 0
      ) {
        throw new Error('Invalid nonnegative route objective');
      }
      const next: Cost = [current.cost[0] + primary, current.cost[1] + seconds];
      const order = compare(next, costs[to]);
      if (order > 0) return;
      if (order < 0) {
        if (stats) stats.relaxedEdges++;
        costs[to] = next;
        previous[to] = [];
        push(to, next);
      }
      previous[to].push({ ...step, previousState: current.node });
    };
    graph.edgesFrom(node).forEach((edge, link) => {
      if (blockedPairs?.has(node * graph.stationCount + edge.toIndex)) return;
      relax(
        edge.toIndex * stateCount + (stateCount === 3 ? 1 : 0),
        edge.durationSec,
        mode === 'FASTEST'
          ? edge.durationSec
          : mode === 'FEWEST_TRANSFERS' && state === 2
            ? 1
            : 0,
        { from: node, link, isTransfer: false },
      );
    });
    graph.transfersFrom(node).forEach((transfer, link) => {
      // Distance is explicitly an estimate from walking time, expressed as integer millimetres.
      const primary =
        mode === 'LEAST_WALK'
          ? transfer.walkingDurationSec * 1200
          : mode === 'FEWEST_TRANSFERS'
            ? 0
            : transfer.walkingDurationSec;
      relax(
        transfer.toIndex * stateCount +
          (stateCount === 3 && state !== 0 ? 2 : 0),
        transfer.walkingDurationSec,
        primary,
        { from: node, link, isTransfer: true },
      );
    });
  }
  if (!Number.isFinite(destinationCost()[0])) throw new RouteNotFoundError();
  let best: RouteResult | undefined;
  let fareError: unknown;
  const reverse: ObjectiveStep[] = [];
  const visiting = new Set<number>();
  const visit = (node: number): void => {
    if (node === start) {
      try {
        const result = materialize([...reverse].reverse());
        if (
          !best ||
          result.totalFare < best.totalFare ||
          (result.totalFare === best.totalFare &&
            result.stationIds.join('|') < best.stationIds.join('|'))
        )
          best = result;
      } catch (error) {
        fareError = error;
      }
      return;
    }
    // Zero-time cycles have no useful objective improvement and must not recurse forever.
    if (visiting.has(node)) return;
    visiting.add(node);
    for (const step of previous[node]) {
      reverse.push(step);
      visit(step.previousState);
      reverse.pop();
    }
    visiting.delete(node);
  };
  for (const target of targetStates) {
    if (compare(costs[target], destinationCost()) === 0) visit(target);
  }
  if (!best) {
    if (fareError) throw fareError;
    throw new RouteNotFoundError();
  }
  return best;
}
