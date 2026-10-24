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
const REST_SPEED = 0.05;
const SPINNER_HALF = 0.07;
const MOVER_HALF = 0.03;

// k = proportional drag (1/s), decel = rolling resistance (m/s²)
export const SURFACES = {
  grass: { k: 0.32, decel: 0.8 },
  sand:  { k: 2.6, decel: 4.2 },
  ice:   { k: 0.06, decel: 0.12 },
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

function wallSegments(hole) {
  const segs = [];
  const pts = hole.shape;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    segs.push({ x1, z1, x2, z2 });
  }
  for (const [x1, z1, x2, z2] of hole.walls || []) segs.push({ x1, z1, x2, z2 });
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
    this.ball = { x: hole.tee[0], z: hole.tee[1], vx: 0, vz: 0 };
    this.t = 0;
    this.restTime = 0;
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

  get moving() {
    return this.ball.vx !== 0 || this.ball.vz !== 0;
  }

  place(x, z) {
    Object.assign(this.ball, { x, z, vx: 0, vz: 0 });
    this.restTime = 0;
  }

  shoot(angle, power) {
    const v = shotSpeed(power);
    this.ball.vx = Math.sin(angle) * v;
    this.ball.vz = Math.cos(angle) * v;
    this.restTime = 0;
  }

  // Advances one STEP. Returns null or the event that ended the roll:
  // { type: 'cup' | 'water' | 'lost' }. Wall hits are reported through onHit.
  step(onHit) {
    const b = this.ball;
    const dt = STEP;
    this.t += dt;

    const surf = SURFACES[this.terrain.surfaceAt(b.x, b.z)] || SURFACES.grass;
    const [gx, gz] = this.terrain.grad(b.x, b.z);
    const norm = 1 + gx * gx + gz * gz;
    const ax = (-GRAVITY * ROLLING * gx) / norm;
    const az = (-GRAVITY * ROLLING * gz) / norm;
    const slopePull = Math.hypot(ax, az);

    let sp = Math.hypot(b.vx, b.vz);
    // A still ball stays put while friction can hold it on this slope; only
    // obstacles move it then.
    if (sp > 0 || slopePull > surf.decel) {
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
    }

    // Counts how long the ball has been (nearly) still. A ball held against
    // a rail by a slope creeps at a few mm/s, which still counts as stopped.
    this.restTime = Math.hypot(b.vx, b.vz) < REST_SPEED ? this.restTime + dt : 0;

    for (const w of this.water) {
      if (zoneContains(w, b.x, b.z, 0.92)) return { type: 'water' };
    }
    if (!insidePolygon(this.hole.shape, b.x, b.z)) return { type: 'lost' };
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
    const limit = CUP_CAPTURE_SPEED * (d < CUP_R * 0.4 ? 1.4 : 1);
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

  collide(onHit) {
    const t = this.t;
    for (const s of this.walls) this.hitSegment(s, WALL_HALF, 0, 0, null, onHit);
    for (const sp of this.hole.spinners || []) {
      const a = spinnerAngle(sp, t);
      const ux = Math.cos(a) * sp.len, uz = Math.sin(a) * sp.len;
      const seg = { x1: sp.x - ux, z1: sp.z - uz, x2: sp.x + ux, z2: sp.z + uz };
      this.hitSegment(seg, SPINNER_HALF, 0, 0, sp, onHit);
    }
    for (const m of this.hole.movers || []) {
      const st = moverState(m, t);
      const hw = m.w / 2 - MOVER_HALF, hd = m.d / 2 - MOVER_HALF;
      const corners = [
        [st.x - hw, st.z - hd], [st.x + hw, st.z - hd],
        [st.x + hw, st.z + hd], [st.x - hw, st.z + hd],
      ];
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = corners[i], [x2, z2] = corners[(i + 1) % 4];
        this.hitSegment({ x1, z1, x2, z2 }, MOVER_HALF, st.vx, st.vz, null, onHit);
      }
    }
  }

  // Treats the segment as a capsule of radius `half`, moving with (svx, svz)
  // or spinning about spinner's hub.
  hitSegment(s, half, svx, svz, spinner, onHit) {
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
    if (impact < SOFT_IMPACT) {
      rvx -= vn * nx;
      rvz -= vn * nz;
    } else {
      rvx -= (1 + RESTITUTION) * vn * nx;
      rvz -= (1 + RESTITUTION) * vn * nz;
      // A little scrub along the rail.
      const vt = rvx * -nz + rvz * nx;
      rvx -= -nz * vt * 0.06;
      rvz -= nx * vt * 0.06;
      if (onHit) onHit(impact, b.x - nx * BALL_R, b.z - nz * BALL_R);
    }
    b.vx = rvx + svx;
    b.vz = rvz + svz;
  }
}
