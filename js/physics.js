import { insidePolygon, zoneContains } from './terrain.js';

// ---- Tuning ---------------------------------------------------------------

export const BALL_R = 0.1;
export const CUP_R = 0.19;
export const WALL_HALF = 0.06;        // half the thickness of every rail
export const MAX_SPEED = 9.5;         // m/s at full power
export const POWER_CURVE = 1.5;       // speed = MAX_SPEED * power^curve: fine control on short putts
export const CUP_CAPTURE_SPEED = 2.1; // faster than this and the ball lips out
export const STEP = 1 / 240;          // fixed physics step (s)

const GRAVITY = 9.8;
const ROLLING = 5 / 7;                // a rolling ball feels 5/7 of the pull down a slope
const RESTITUTION = 0.7;
const SOFT_IMPACT = 0.25;             // slower hits than this don't bounce
export const REST_SPEED = 0.05;     // slower than this counts as stopped
const SPINNER_HALF = 0.07;
const MOVER_HALF = 0.03;
export const GAP_MIN_SPEED = 2.6;     // slower than this at the edge of a gap and the ball drops in
const BUMPER_KICK = 1.4;              // bumpers add this much speed (m/s) on every hit
export const PIPE_R = 0.24;           // warp pipe mouth
const PIPE_MAX_SPEED = 5;             // faster balls skip over the pipe
const PIPE_MIN_OUT = 4.4;             // the far pipe shoots the ball out at least this fast (m/s)
const WINDMILL_GATE = 0.22;           // rad either side of straight down where a sail blocks the door

// k = proportional drag (1/s), decel = rolling resistance (m/s²)
export const SURFACES = {
  grass: { k: 0.32, decel: 0.8 },
  sand:  { k: 2.6, decel: 4.2 },
  ice:   { k: 0.06, decel: 0.12 },
  frost: { k: 0.22, decel: 0.5 },      // a frozen fairway: slick, but you can still judge it
  moss:  { k: 2.0, decel: 3.0 },       // soft: settles a ball on a small stepping stone
  water: { k: 0.32, decel: 0.8 },
};

export function shotSpeed(power) {
  return MAX_SPEED * Math.pow(Math.max(0, Math.min(1, power)), POWER_CURVE);
}

// ---- Obstacles ------------------------------------------------------------

export function spinnerAngle(s, t) {
  return (s.phase || 0) + s.speed * t;
}

export function moverState(m, t) {
  const w = (Math.PI * 2) / m.period;
  const a = w * t + (m.phase || 0);
  const f = 0.5 - 0.5 * Math.cos(a);
  const df = 0.5 * w * Math.sin(a);
  return {
    x: m.x1 + (m.x2 - m.x1) * f,
    z: m.z1 + (m.z2 - m.z1) * f,
    vx: (m.x2 - m.x1) * df,
    vz: (m.z2 - m.z1) * df,
  };
}

// Windmill sails turn in the plane of the front wall; sail k points at
// angle a + k·π/2, measured from straight up, clockwise as you face it.
export function windmillAngle(w, t) {
  return (w.phase || 0) + (Math.PI * 2 * t) / w.period;
}

// True while a sail hangs down across the windmill's doorway.
export function windmillBlocked(w, t) {
  const a = windmillAngle(w, t);
  for (let k = 0; k < 4; k++) {
    const d = Math.atan2(Math.sin(a + (k * Math.PI) / 2 - Math.PI), Math.cos(a + (k * Math.PI) / 2 - Math.PI));
    if (Math.abs(d) < WINDMILL_GATE) return true;
  }
  return false;
}

// The windmill's walls: a box with a tunnel through it along z.
function windmillWalls(w) {
  const x0 = w.x - w.w / 2, x1 = w.x + w.w / 2, z0 = w.z - w.d / 2, z1 = w.z + w.d / 2;
  const t = w.door / 2;
  return [
    [x0, z0, w.x - t, z0], [w.x + t, z0, x1, z0],
    [x0, z1, w.x - t, z1], [w.x + t, z1, x1, z1],
    [x0, z0, x0, z1], [x1, z0, x1, z1],
    [w.x - t, z0, w.x - t, z1], [w.x + t, z0, w.x + t, z1],
  ];
}

// Stretches with open sky beside the fairway and no rails: rope bridges,
// and gaps that split the island in two. Roll off the side there and the
// ball falls.
export function openBands(hole) {
  return [...(hole.ropeBridges || []), ...(hole.gaps || []).filter(g => g.split)];
}

// The parts of a segment outside every band: [[x1, z1, x2, z2], ...].
export function clipToBands(seg, bands) {
  let pieces = [seg];
  for (const { z1: b1, z2: b2 } of bands) {
    pieces = pieces.flatMap(([x1, z1, x2, z2]) => {
      const at = z => (z2 === z1 ? 0 : (z - z1) / (z2 - z1));
      const pt = t => [x1 + (x2 - x1) * t, z1 + (z2 - z1) * t];
      const lo = Math.min(z1, z2), hi = Math.max(z1, z2);
      if (hi <= b1 || lo >= b2) return [[x1, z1, x2, z2]];
      if (lo >= b1 && hi <= b2) return [];
      const ta = Math.max(0, Math.min(1, at(b1))), tb = Math.max(0, Math.min(1, at(b2)));
      const [t0, t1] = ta < tb ? [ta, tb] : [tb, ta];
      const out = [];
      if (t0 > 1e-6) out.push([x1, z1, ...pt(t0)]);
      if (t1 < 1 - 1e-6) out.push([...pt(t1), x2, z2]);
      return out;
    });
  }
  return pieces;
}

function wallSegments(hole) {
  const segs = [];
  const pts = hole.shape;
  const bands = openBands(hole);
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    for (const [a, b, c, d] of clipToBands([x1, z1, x2, z2], bands)) segs.push({ x1: a, z1: b, x2: c, z2: d });
  }
  const extra = [...(hole.walls || []), ...(hole.windmills || []).flatMap(windmillWalls)];
  for (const [x1, z1, x2, z2] of extra) segs.push({ x1, z1, x2, z2 });
  return segs;
}

// ---- Simulation -----------------------------------------------------------

// One ball on one hole. `t` keeps running while the ball is still, so
// spinners and movers keep moving (and can knock a resting ball).
export class Sim {
  constructor(hole, terrain) {
    this.hole = hole;
    this.terrain = terrain;
    this.walls = wallSegments(hole);
    this.water = (hole.zones || []).filter(z => z.type === 'water');
    this.open = openBands(hole);
    this.ball = { x: hole.tee[0], z: hole.tee[1], vx: 0, vz: 0 };
    this.t = 0;
    this.restTime = 0;
    this.air = null;    // the gap the ball is flying over, if any
    this.warps = 0;     // counts trips through a warp pipe (for sound and effects)
  }

  clone() {
    const s = Object.create(Sim.prototype);
    Object.assign(s, this);
    s.ball = { ...this.ball };
    return s;
  }

  get speed() {
    return Math.hypot(this.ball.vx, this.ball.vz);
  }

  // A ball held against a rail by a slope keeps creeping at a few mm/s;
  // that counts as stopped, so it can be putted.
  get moving() {
    return this.speed >= REST_SPEED;
  }

  place(x, z) {
    Object.assign(this.ball, { x, z, vx: 0, vz: 0 });
    this.restTime = 0;
    this.air = null;
  }

  // A gap spans the whole hole between z1 and z2.
  gapAt(z) {
    for (const g of this.hole.gaps || []) if (z > g.z1 && z < g.z2) return g;
    return null;
  }

  shoot(angle, power) {
    const v = shotSpeed(power);
    this.ball.vx = Math.sin(angle) * v;
    this.ball.vz = Math.cos(angle) * v;
    this.restTime = 0;
  }

  // Advances one STEP. Returns null or the event that ended the roll:
  // { type: 'cup' | 'water' | 'fall' | 'lost' } ('fall' says `off: true` for
  // the side of a bridge or open gap). Hits on rails and obstacles
  // are reported through onHit(speed, x, z, what).
  step(onHit) {
    const b = this.ball;
    const dt = STEP;
    this.t += dt;

    // Gaps: reach the edge fast enough and the ball flies across with
    // nothing slowing it; too slow and it drops in.
    const gap = this.gapAt(b.z);
    if (gap && !this.air) {
      if (Math.abs(b.vz) < (gap.minSpeed || GAP_MIN_SPEED)) return { type: 'fall' };
      this.air = { gap, from: b.vz > 0 ? gap.z1 : gap.z2, to: b.vz > 0 ? gap.z2 : gap.z1 };
    } else if (!gap && this.air) {
      this.air = null;
    }

    // Low gravity (the Moon) weakens both the pull down slopes and the
    // rolling resistance, which comes from the ball's weight.
    const grav = this.hole.gravity || 1;
    const base = SURFACES[this.terrain.surfaceAt(b.x, b.z)] || SURFACES.grass;
    const surf = grav === 1 ? base : { k: base.k, decel: base.decel * grav };
    const [gx, gz] = this.terrain.grad(b.x, b.z);
    const norm = 1 + gx * gx + gz * gz;
    const ax = (-GRAVITY * grav * ROLLING * gx) / norm;
    const az = (-GRAVITY * grav * ROLLING * gz) / norm;
    const slopePull = Math.hypot(ax, az);

    let sp = Math.hypot(b.vx, b.vz);
    // A still ball stays put while friction can hold it on this slope; only
    // obstacles move it then.
    if (!this.air && (sp > 0 || slopePull > surf.decel)) {
      b.vx += ax * dt;
      b.vz += az * dt;
      sp = Math.hypot(b.vx, b.vz);
      const drop = (surf.decel + surf.k * sp) * dt;
      if (sp <= drop) {
        b.vx = 0;
        b.vz = 0;
      } else {
        b.vx *= (sp - drop) / sp;
        b.vz *= (sp - drop) / sp;
      }
      sp = Math.hypot(b.vx, b.vz);
      if (sp < REST_SPEED && slopePull <= surf.decel) {
        b.vx = 0;
        b.vz = 0;
        sp = 0;
      }
    }

    // Sub-step the movement so a fast ball can't slip through a rail.
    const n = Math.max(1, Math.ceil((sp * dt) / (BALL_R * 0.4)));
    for (let i = 0; i < n; i++) {
      b.x += (b.vx * dt) / n;
      b.z += (b.vz * dt) / n;
      this.collide(onHit);
      const ev = this.checkCup(dt / n);
      if (ev) return ev;
      this.checkPipes();
    }

    // Counts how long the ball has been (nearly) still. A ball held against
    // a rail by a slope creeps at a few mm/s, which still counts as stopped.
    this.restTime = Math.hypot(b.vx, b.vz) < REST_SPEED ? this.restTime + dt : 0;

    for (const w of this.water) {
      if (zoneContains(w, b.x, b.z, 0.92)) return { type: 'water' };
    }
    if (!insidePolygon(this.hole.shape, b.x, b.z)) {
      // No rail here: over the side it goes.
      if (this.open.some(o => b.z > o.z1 && b.z < o.z2)) return { type: 'fall', off: true };
      return { type: 'lost' };
    }
    return null;
  }

  checkCup(dt) {
    const b = this.ball;
    const [cx, cz] = this.hole.cup;
    const dx = cx - b.x, dz = cz - b.z;
    const d = Math.hypot(dx, dz);
    if (d >= CUP_R) return null;
    const sp = Math.hypot(b.vx, b.vz);
    // Dead centre forgives a little more pace than a ball clipping the edge.
    // In low gravity the ball is held in less, so it lips out more easily.
    const limit = CUP_CAPTURE_SPEED * Math.sqrt(this.hole.gravity || 1) * (d < CUP_R * 0.4 ? 1.4 : 1);
    if (sp < limit) return { type: 'cup' };
    // Too fast: the ball dips over the lip, gets tugged towards the middle
    // and loses a little speed, so a near miss curls rather than flies on.
    if (d > 1e-6) {
      const pull = 14 * (1 - d / CUP_R);
      b.vx += (dx / d) * pull * dt;
      b.vz += (dz / d) * pull * dt;
    }
    b.vx *= 1 - 1.2 * dt;
    b.vz *= 1 - 1.2 * dt;
    return null;
  }

  // A ball rolling into a warp pipe comes out of the other end, heading the
  // way that pipe faces.
  checkPipes() {
    const b = this.ball;
    for (const p of this.hole.pipes || []) {
      const [fx, fz] = p.from;
      if (Math.hypot(b.x - fx, b.z - fz) >= PIPE_R - BALL_R * 0.3) continue;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > PIPE_MAX_SPEED) continue;
      const ux = Math.sin(p.dir), uz = Math.cos(p.dir);
      const out = Math.max(PIPE_MIN_OUT, sp * 0.85);
      // Out beside the far pipe's stub, which is solid.
      b.x = p.to[0] + ux * (PIPE_R + BALL_R + 0.03);
      b.z = p.to[1] + uz * (PIPE_R + BALL_R + 0.03);
      b.vx = ux * out;
      b.vz = uz * out;
      this.warps++;
      return;
    }
  }

  collide(onHit) {
    const t = this.t;
    // Bouncy rails (cloud cushions) add a kick, like bumpers.
    const railOpts = this.hole.railKick ? { kick: this.hole.railKick, what: 'cushion', soft: true } : null;
    for (const s of this.walls) this.hitSegment(s, WALL_HALF, 0, 0, null, onHit, railOpts);
    for (const w of this.hole.windmills || []) {
      if (!windmillBlocked(w, t)) continue;
      // A sail hangs across the doorway, just in front of the wall.
      const zf = w.z - w.d / 2 - 0.08;
      const gate = this.gateSeg || (this.gateSeg = {});
      Object.assign(gate, { x1: w.x - w.door / 2, z1: zf, x2: w.x + w.door / 2, z2: zf });
      this.hitSegment(gate, 0.04, 0, 0, null, onHit, { what: 'sail' });
    }
    for (const p of this.hole.pipes || []) {
      const seg = this.pipeSeg || (this.pipeSeg = {});
      Object.assign(seg, { x1: p.to[0], z1: p.to[1], x2: p.to[0], z2: p.to[1] });
      this.hitSegment(seg, PIPE_R, 0, 0, null, onHit);
    }
    (this.hole.bumpers || []).forEach((bp, i) => {
      const seg = this.bumperSeg || (this.bumperSeg = {});
      Object.assign(seg, { x1: bp.x, z1: bp.z, x2: bp.x, z2: bp.z });
      this.hitSegment(seg, bp.r, 0, 0, null, onHit, { kick: BUMPER_KICK, what: 'bumper', index: i });
    });
    for (const sp of this.hole.spinners || []) {
      const a = spinnerAngle(sp, t);
      const ux = Math.cos(a) * sp.len, uz = Math.sin(a) * sp.len;
      const seg = { x1: sp.x - ux, z1: sp.z - uz, x2: sp.x + ux, z2: sp.z + uz };
      this.hitSegment(seg, SPINNER_HALF, 0, 0, sp, onHit);
    }
    for (const m of this.hole.movers || []) {
      const st = moverState(m, t);
      const hw = m.w / 2 - MOVER_HALF, hd = m.d / 2 - MOVER_HALF;
      const x0 = st.x - hw, x1 = st.x + hw, z0 = st.z - hd, z1 = st.z + hd;
      const seg = this.moverSeg || (this.moverSeg = {});
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
        seg.x1 = ax; seg.z1 = az; seg.x2 = bx; seg.z2 = bz;
        this.hitSegment(seg, MOVER_HALF, st.vx, st.vz, null, onHit);
      }
    }
  }

  // Treats the segment as a capsule of radius `half`, moving with (svx, svz)
  // or spinning about spinner's hub. `opts.kick` adds speed away from it
  // (bumpers); `opts.what` names it for onHit.
  hitSegment(s, half, svx, svz, spinner, onHit, opts) {
    const b = this.ball;
    const px = s.x2 - s.x1, pz = s.z2 - s.z1;
    const len2 = px * px + pz * pz;
    let u = len2 ? ((b.x - s.x1) * px + (b.z - s.z1) * pz) / len2 : 0;
    u = Math.max(0, Math.min(1, u));
    const cx = s.x1 + px * u, cz = s.z1 + pz * u;
    let dx = b.x - cx, dz = b.z - cz;
    const r = half + BALL_R;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    let d = Math.sqrt(d2);
    if (d < 1e-6) {
      // Dead centre on the line: push out along its normal.
      const l = Math.sqrt(len2) || 1;
      dx = -pz / l;
      dz = px / l;
      d = 1;
    }
    const nx = dx / d, nz = dz / d;
    b.x = cx + nx * r;
    b.z = cz + nz * r;

    if (spinner) {
      // Surface velocity of the bar where it touches the ball.
      const ox = cx - spinner.x, oz = cz - spinner.z;
      svx = -spinner.speed * oz;
      svz = spinner.speed * ox;
    }
    let rvx = b.vx - svx, rvz = b.vz - svz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const impact = -vn;
    // `soft` kickers only kick a real hit, so a ball resting against one
    // isn't jostled.
    if (opts && opts.kick && !(opts.soft && impact < SOFT_IMPACT)) {
      rvx += (-(1 + RESTITUTION) * vn + opts.kick) * nx;
      rvz += (-(1 + RESTITUTION) * vn + opts.kick) * nz;
      if (onHit) onHit(impact + opts.kick, b.x - nx * BALL_R, b.z - nz * BALL_R, opts);
    } else if (impact < SOFT_IMPACT) {
      rvx -= vn * nx;
      rvz -= vn * nz;
    } else {
      rvx -= (1 + RESTITUTION) * vn * nx;
      rvz -= (1 + RESTITUTION) * vn * nz;
      // A little scrub along the rail.
      const vt = rvx * -nz + rvz * nx;
      rvx -= -nz * vt * 0.06;
      rvz -= nx * vt * 0.06;
      if (onHit) onHit(impact, b.x - nx * BALL_R, b.z - nz * BALL_R, opts);
    }
    b.vx = rvx + svx;
    b.vz = rvz + svz;
  }
}
