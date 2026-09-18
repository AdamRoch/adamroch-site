/* ————— damped spring toward a moving target; semi-implicit Euler with substeps ————— */

export class Spring {
  x: number;
  v = 0;
  target: number;
  private readonly k: number;
  private readonly c: number;

  // zeta 1 = critically damped; < 1 under-damped
  constructor(x: number, k: number, zeta = 1) {
    this.x = x;
    this.target = x;
    this.k = k;
    this.c = 2 * zeta * Math.sqrt(k);
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
  }

  snap(): void {
    this.x = this.target;
    this.v = 0;
  }
}
