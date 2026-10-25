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
function estimate(hole, x, z) {
  const [cx, cz] = hole.cup;
  const d = Math.hypot(cx - x, cz - z);
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

// Finds the best few shots if hit perfectly (a coarse search, then a finer
// one round the best), then keeps the one that does best on average when
// missed by this player's usual amount.
function chooseShot(hole, sim, skill) {
  const from = [sim.ball.x, sim.ball.z];
  const toCup = Math.atan2(hole.cup[0] - from[0], hole.cup[1] - from[1]);
  const deg = Math.PI / 180;
  const tryShot = (a, p) => ({ a, p, c: cost(hole, from, roll(sim, a, p)) });
  const coarse = [];
  for (let da = -36; da <= 36; da += 4) {
    for (let p = 0.05; p <= 1.001; p += 0.05) coarse.push(tryShot(toCup + da * deg, p));
  }
  // Of shots that are equally good if hit perfectly, the gentler is safer.
  const better = (x, y) => x.c - y.c || x.p - y.p;
  coarse.sort(better);
  const fine = [...coarse.slice(0, 4)];
  for (const c of coarse.slice(0, 4)) {
    for (let da = -2; da <= 2; da += 1) {
      for (let dp = -0.02; dp <= 0.021; dp += 0.01) {
        if (da || Math.abs(dp) > 1e-9) fine.push(tryShot(c.a + da * deg, Math.min(1, Math.max(0.02, c.p + dp))));
      }
    }
  }
  fine.sort(better);
  let best = null;
  for (const c of fine.slice(0, 6)) {
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
