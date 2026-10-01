// Binary min-heap on typed arrays, so a search allocates two buffers instead of one object per push.
// Entries are never decreased in place: a station is pushed again with its better priority and the
// stale entry is skipped by the caller (lazy deletion).
export class MinPriorityQueue {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private length = 0;

  constructor(initialCapacity = 64) {
    this.nodes = new Int32Array(initialCapacity);
    this.priorities = new Float64Array(initialCapacity);
  }

  get size(): number {
    return this.length;
  }

  push(node: number, priority: number): void {
    if (this.length === this.nodes.length) this.grow();
    let child = this.length++;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.nodes[child] = this.nodes[parent];
      this.priorities[child] = this.priorities[parent];
      child = parent;
    }
    this.nodes[child] = node;
    this.priorities[child] = priority;
  }

  // the priority of the entry returned by the last pop() is available in lastPriority
  lastPriority = 0;

  pop(): number {
    if (this.length === 0) throw new Error('pop from an empty queue');
    const top = this.nodes[0];
    this.lastPriority = this.priorities[0];
    this.length -= 1;
    if (this.length > 0) {
      const node = this.nodes[this.length];
      const priority = this.priorities[this.length];
      let parent = 0;
      for (;;) {
        let child = parent * 2 + 1;
        if (child >= this.length) break;
        if (
          child + 1 < this.length &&
          this.priorities[child + 1] < this.priorities[child]
        ) {
          child += 1;
        }
        if (this.priorities[child] >= priority) break;
        this.nodes[parent] = this.nodes[child];
        this.priorities[parent] = this.priorities[child];
        parent = child;
      }
      this.nodes[parent] = node;
      this.priorities[parent] = priority;
    }
    return top;
  }

  private grow(): void {
    const nodes = new Int32Array(this.nodes.length * 2);
    const priorities = new Float64Array(this.priorities.length * 2);
    nodes.set(this.nodes);
    priorities.set(this.priorities);
    this.nodes = nodes;
    this.priorities = priorities;
  }
}
