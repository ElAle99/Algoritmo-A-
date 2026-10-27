/** Deterministic binary min-heap. Decrease-key uses immutable entries and stale-entry checks. */
export class MinHeap<T> {
  private values: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  get size() {
    return this.values.length;
  }
  push(value: T) {
    const a = this.values;
    let i = a.length;
    a.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(a[parent], value) <= 0) break;
      a[i] = a[parent];
      i = parent;
    }
    a[i] = value;
  }
  pop(): T | undefined {
    const a = this.values;
    if (!a.length) return;
    const top = a[0],
      tail = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && this.compare(a[child + 1], a[child]) < 0)
          child++;
        if (this.compare(tail, a[child]) <= 0) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = tail;
    }
    return top;
  }
}
