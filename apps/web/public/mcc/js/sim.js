// Seeded 10 Hz simulation: motors start and stop, per-phase current, terminal temperatures follow I².
// One contactor (hotId) has a degrading L2 joint whose extra resistance keeps climbing.
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export class Sim {
  constructor(specs, hotId, seed = 480) {
    this.r = rng(seed); this.t = 0; this.amb = 27; this.hotId = hotId;
    this.s = new Map();
    for (const b of specs) {
      const hot = b.id === hotId, running = hot || this.r() < .62;
      const load = hot ? .82 : .45 + this.r() * .45;
      const T = this.amb + 4 + (running ? 22 * load * load : 0);
      this.s.set(b.id, { id: b.id, fla: b.fla, running, load, target: load, amps: [0, 0, 0], imb: [this.r() * .04 - .02, this.r() * .04 - .02, this.r() * .04 - .02],
        temps: { L1: T, L2: hot ? 71 : T, L3: T, body: T - 4, ol: T - 6, brk: T - 8, back: this.amb + 2, door: this.amb + 2 }, hist: [] });
    }
  }
  step(dt = .1) {
    this.t += dt; const r = this.r, amb = this.amb;
    for (const s of this.s.values()) {
      const hot = s.id === this.hotId;
      if (!hot && r() < .0009) { s.running = !s.running; if (s.running) s.load = .1; }
      if (r() < .01) s.target = hot ? .78 + r() * .08 : .4 + r() * .55;
      s.load += ((s.running ? s.target : 0) - s.load) * (1 - Math.exp(-dt * (s.running ? 1.2 : 3)));
      const inrush = s.running && s.load < .3 ? 1.8 : 1;
      s.amps = s.imb.map((e) => Math.max(0, s.fla * s.load * inrush * (1 + e + (r() - .5) * .01)));
      const rise = (i) => 22 * (s.amps[i] / s.fla) ** 2;
      const hotExtra = hot ? Math.min(31.5, 27 + this.t * .08) * (s.load / .82) ** 2 : 0;
      const tgt = { L1: amb + 4 + rise(0), L2: amb + 4 + rise(1) + hotExtra, L3: amb + 4 + rise(2) };
      const k = 1 - Math.exp(-dt / 6);
      for (const ph of ["L1", "L2", "L3"]) s.temps[ph] += (tgt[ph] - s.temps[ph]) * k;
      const avg = (s.temps.L1 + s.temps.L2 + s.temps.L3) / 3, mx = Math.max(s.temps.L1, s.temps.L2, s.temps.L3);
      s.temps.body = amb + (avg - amb) * .45 + (mx - avg) * .15;
      s.temps.ol = amb + (avg - amb) * .35;
      s.temps.brk = amb + (avg - amb) * .45;
      s.temps.back = amb + 2 + (mx - amb) * .12;
      s.temps.door = amb + 1 + (mx - amb) * .22;
      if ((Math.round(this.t * 10) % 5) === 0) { s.hist.push(mx); if (s.hist.length > 240) s.hist.shift(); }
    }
    return this.s;
  }
}
