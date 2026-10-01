import { MinPriorityQueue } from './min-priority-queue';

describe('MinPriorityQueue', () => {
  it('pops entries in priority order and exposes the popped priority', () => {
    const queue = new MinPriorityQueue(2);
    [
      [3, 30],
      [1, 10],
      [4, 40],
      [2, 20],
      [5, 5],
    ].forEach(([node, priority]) => queue.push(node, priority));

    const order: number[] = [];
    const priorities: number[] = [];
    while (queue.size > 0) {
      order.push(queue.pop());
      priorities.push(queue.lastPriority);
    }

    expect(order).toEqual([5, 1, 2, 3, 4]);
    expect(priorities).toEqual([5, 10, 20, 30, 40]);
  });

  it('keeps equal priorities and grows past its initial capacity', () => {
    const queue = new MinPriorityQueue(1);
    for (let i = 0; i < 100; i += 1) queue.push(i, i % 3);

    let previous = -1;
    let count = 0;
    while (queue.size > 0) {
      queue.pop();
      expect(queue.lastPriority).toBeGreaterThanOrEqual(previous);
      previous = queue.lastPriority;
      count += 1;
    }
    expect(count).toBe(100);
  });

  it('throws when popping an empty queue', () => {
    expect(() => new MinPriorityQueue().pop()).toThrow();
  });
});
