/** A spatial hash of the clay's vertices, so a brush looks only at the
 * vertices near it instead of all of them (a mannequin has 240,000).
 *
 * Built from the positions at a moment; vertices then move a little
 * during a stroke, so queries look `margin` further out and every
 * candidate is still checked against its current position: a vertex is
 * found as long as it moved less than the margin since the build. */

const P1 = 73856093;
const P2 = 19349663;
const P3 = 83492791;

export class VertexGrid {
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;
  private readonly mask: number;
  readonly cell: number;

  constructor(positions: Float32Array, cell: number) {
    this.cell = cell;
    const n = positions.length / 3;
    let size = 1;
    while (size < n * 2) size <<= 1;
    this.mask = size - 1;
    const keys = new Uint32Array(n);
    const counts = new Uint32Array(size + 1);
    for (let v = 0; v < n; v++) {
      const k = this.key(
        Math.floor(positions[v * 3] / cell),
        Math.floor(positions[v * 3 + 1] / cell),
        Math.floor(positions[v * 3 + 2] / cell),
      );
      keys[v] = k;
      counts[k + 1]++;
    }
    for (let i = 0; i < size; i++) counts[i + 1] += counts[i];
    this.start = counts;
    const fill = counts.slice(0, size);
    this.items = new Uint32Array(n);
    for (let v = 0; v < n; v++) this.items[fill[keys[v]]++] = v;
  }

  private key(x: number, y: number, z: number): number {
    return (Math.imul(x, P1) ^ Math.imul(y, P2) ^ Math.imul(z, P3)) & this.mask;
  }

  /** Call `visit` with every vertex that may be within `radius` of `c`
   * (each at most once; check the distance yourself). */
  near(c: readonly number[], radius: number, visit: (v: number) => void): void {
    const lo = [0, 1, 2].map((a) => Math.floor((c[a] - radius) / this.cell));
    const hi = [0, 1, 2].map((a) => Math.floor((c[a] + radius) / this.cell));
    const cells =
      (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    // Different cells can share a hash slot: visit each slot once.
    const seen = cells > 1 ? new Set<number>() : null;
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = this.key(x, y, z);
          if (seen) {
            if (seen.has(k)) continue;
            seen.add(k);
          }
          for (let i = this.start[k]; i < this.start[k + 1]; i++)
            visit(this.items[i]);
        }
  }
}
