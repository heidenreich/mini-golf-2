// A simulated player, for tuning holes. It picks a sensible shot, then
// misses it by a gaussian amount, and plays each hole many times.
//
//   node tools/simulate.mjs                             every hole
//   node tools/simulate.mjs "Rope Bridge" 200           one hole, 200 tries per skill
//   node tools/simulate.mjs "Rope Bridge" 200 careful   one skill only
//
// It's slow (a second or two a stroke), so run holes in parallel when
// tuning several.
//
// Prints the average score and how often each score came up, for careful
// players (about ±3° and ±8% power) and casual ones (±6°, ±15%).

import { COURSE } from '../js/courses.js';
import { makeTerrain } from '../js/terrain.js';
import { Sim } from '../js/physics.js';

const MAX_STROKES = 8;
const MAX_STEPS = 240 * 20;   // a roll this long is called stopped
const SKILLS = {
  careful: { angle: (3 * Math.PI) / 180, power: 0.08 },
  casual: { angle: (6 * Math.PI) / 180, power: 0.15 },
};

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// Plays one shot from where the sim's ball is. Returns { event, x, z }.
function roll(sim, angle, power) {
  const s = sim.clone();
  s.restTime = 0;
  s.shoot(angle, power);
  for (let i = 0; i < MAX_STEPS; i++) {
    const ev = s.step();
    if (ev) return { event: ev.type, x: s.ball.x, z: s.ball.z, sim: s };
    if (s.restTime > 0.3) break;
  }
  return { event: null, x: s.ball.x, z: s.ball.z, sim: s };
}

// Roughly how many more strokes from (x, z): close is one putt, further is
// more, and every gap or bridge still to cross adds risk.
// Distance still to roll, along the hole: via the furthest point on its
// route (round any corners) that the ball can see without a rail in the
// way, as a player would think of it. A straight line through a dogleg's
// corner rail would lure the player into nudging along the rail.
const walls = new WeakMap();
const crosses = (ax, az, bx, bz, w) => {
  const side = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  return side(w.x1, w.z1, w.x2, w.z2, ax, az) * side(w.x1, w.z1, w.x2, w.z2, bx, bz) < 0
    && side(ax, az, bx, bz, w.x1, w.z1) * side(ax, az, bx, bz, w.x2, w.z2) < 0;
};
function distanceToGo(hole, x, z) {
  if (!walls.has(hole)) walls.set(hole, new Sim(hole, makeTerrain(hole)).walls);
  const ws = walls.get(hole);
  const pts = [...(hole.route || []), hole.cup];
  const rest = pts.map((p, i) => pts.slice(i).reduce((sum, q, k, arr) => sum + (k ? Math.hypot(q[0] - arr[k - 1][0], q[1] - arr[k - 1][1]) : 0), 0));
  let best = Infinity;
  pts.forEach(([px, pz], i) => {
    if (ws.some(w => crosses(x, z, px, pz, w))) return;
    best = Math.min(best, Math.hypot(px - x, pz - z) + rest[i]);
  });
  return best < Infinity ? best : Math.hypot(hole.cup[0] - x, hole.cup[1] - z) + rest[0];
}

function estimate(hole, x, z) {
  const d = distanceToGo(hole, x, z);
  let est = d < 0.5 ? 1 : d < 2 ? 1.3 : 1.6 + d / 8;
  for (const g of hole.gaps || []) if (z < g.z1) est += 0.6;
  for (const b of hole.ropeBridges || []) if (z < b.z2) est += 0.4;
  return est;
}

function cost(hole, from, r) {
  if (r.event === 'cup') return 0;
  if (r.event === 'water' || r.event === 'fall') return 1 + estimate(hole, from[0], from[1]);
  if (r.event === 'lost') return estimate(hole, from[0], from[1]);
  return estimate(hole, r.x, r.z);
}

// Searches every direction and strength, then tries a spread of the shots
// that look nearly as good as the best when hit perfectly, each missed by
// this player's usual amount, and keeps the one that does best on average.
// (So it aims for the middle of a safe window, not its edge.)
function chooseShot(hole, sim, skill) {
  const from = [sim.ball.x, sim.ball.z];
  const toCup = Math.atan2(hole.cup[0] - from[0], hole.cup[1] - from[1]);
  const deg = Math.PI / 180;
  const tryShot = (a, p) => ({ a, p, c: cost(hole, from, roll(sim, a, p)) });
  const coarse = [];
  for (let da = -36; da <= 36; da += 4) {
    for (let p = 0.05; p <= 1.001; p += 0.05) coarse.push(tryShot(toCup + da * deg, p));
  }
  coarse.sort((x, y) => x.c - y.c);
  // A finer look round the very best, for shots that need precision.
  const cands = coarse.slice(0, 3);
  for (const c of coarse.slice(0, 3)) {
    for (const [da, dp] of [[-2, 0], [2, 0], [0, -0.02], [0, 0.02]]) cands.push(tryShot(c.a + da * deg, Math.min(1, Math.max(0.02, c.p + dp))));
  }
  // And an even spread of everything nearly as good.
  const good = coarse.filter(c => c.c <= coarse[0].c + 0.35).sort((x, y) => x.p - y.p || x.a - y.a);
  const n = Math.min(12, good.length);
  for (let i = 0; i < n; i++) cands.push(good[Math.floor((i * good.length) / n)]);
  let best = null;
  for (const c of cands) {
    let total = 0;
    for (let k = 0; k < 10; k++) {
      const a = c.a + gauss() * skill.angle, p = Math.min(1, Math.max(0.02, c.p * (1 + gauss() * skill.power)));
      total += cost(hole, from, roll(sim, a, p));
    }
    if (!best || total < best.total) best = { ...c, total };
  }
  return best;
}

function playHole(hole, skill) {
  const terrain = makeTerrain(hole);
  let sim = new Sim(hole, terrain);
  let strokes = 0;
  const events = {};
  while (strokes < MAX_STROKES) {
    const shot = chooseShot(hole, sim, skill);
    const a = shot.a + gauss() * skill.angle;
    const p = Math.min(1, Math.max(0.02, shot.p * (1 + gauss() * skill.power)));
    const from = [sim.ball.x, sim.ball.z];
    const r = roll(sim, a, p);
    strokes++;
    if (r.event) events[r.event] = (events[r.event] || 0) + 1;
    if (r.event === 'cup') return { strokes, events };
    if (r.event === 'water' || r.event === 'fall') strokes++;
    sim = r.sim;
    if (r.event) sim.place(...from);
    sim.ball.vx = sim.ball.vz = 0;
  }
  return { strokes: MAX_STROKES, events };
}

const [name, triesArg, onlySkill] = process.argv.slice(2);
const tries = Number(triesArg) || 60;
const holes = name ? COURSE.holes.filter(h => h.name === name) : COURSE.holes;
if (!holes.length) throw new Error(`No hole called ${name}`);

for (const hole of holes) {
  for (const [skillName, skill] of Object.entries(SKILLS)) {
    if (onlySkill && skillName !== onlySkill) continue;
    seed = 1;
    const scores = {}, events = {};
    let sum = 0;
    for (let i = 0; i < tries; i++) {
      const r = playHole(hole, skill);
      sum += r.strokes;
      scores[r.strokes] = (scores[r.strokes] || 0) + 1;
      for (const [k, v] of Object.entries(r.events)) events[k] = (events[k] || 0) + v;
    }
    const spread = Object.entries(scores).map(([s, n]) => `${s}:${Math.round((n / tries) * 100)}%`).join(' ');
    const ev = Object.entries(events).filter(([k]) => k !== 'cup').map(([k, n]) => `${k} ${(n / tries).toFixed(2)}/round`).join(', ');
    console.log(`${hole.name.padEnd(17)} par ${hole.par}  ${skillName.padEnd(7)} avg ${(sum / tries).toFixed(2)}  [${spread}]${ev ? `  ${ev}` : ''}`);
  }
}
