// Putting and what the ball does: physics events, penalties, sinking and
// where to draw it.
import { Vector3 } from '../vendor/three.module.min.js';
import { $, game, world, holes, MAX_STROKES, STAGES } from './state.js';
import { STEP, BALL_R } from './physics.js';
import { smooth } from './terrain.js';
import { sfx } from './audio.js';
import { toast, updateHud } from './ui.js';
import { saveRound } from './storage.js';
import { cancelDrag } from './input.js';
import { finishHole } from './main.js';

const SETTLE_TIME = 0.3;        // a roll ends once the ball has been still this long

export function shoot(angle, power) {
  if (game.mode !== 'aim' || game.paused || game.sim.moving) return;
  game.lastRest = [game.sim.ball.x, game.sim.ball.z];
  game.undo = { x: game.sim.ball.x, z: game.sim.ball.z, strokes: game.strokes };
  game.sim.shoot(angle, power);
  game.strokes++;
  game.mode = 'rolling';
  game.aim.power = 0;
  game.aim.keyboard = false;
  world.hideAim();
  $('power').hidden = true;
  $('hint').hidden = true;
  sfx.putt(power);
  updateHud();
}

// Spends the mulligan: the ball goes back to where the last putt was played
// from, and that putt (and any penalty it cost) doesn't count.
export function useMulligan() {
  const u = game.undo;
  if (!game.mulligans || !u || game.mode !== 'aim' || game.paused) return;
  game.mulligans = 0;
  game.undo = null;
  game.sim.place(u.x, u.z);
  game.lastRest = [u.x, u.z];
  game.strokes = u.strokes;
  updateHud();
  saveRound();
  toast('Mulligan! Take that putt again');
}

export function pickUp() {
  finishHole(MAX_STROKES, 'Picked up');
  toast(`Picked up after ${MAX_STROKES} strokes`);
}

// The ball is still again (after a putt, a splash or a knock).
function ballReady() {
  game.mode = 'aim';
  game.lastRest = [game.sim.ball.x, game.sim.ball.z];
  if (game.strokes >= MAX_STROKES) return pickUp();
  saveRound();
  if (game.strokes === MAX_STROKES - 1) toast('Last stroke before the ball is picked up');
  // Turn to face down the hole if the view has drifted well off it.
  const yaw = lookYaw();
  if (yaw === null || world.cam.overview) return;
  const off = Math.atan2(Math.sin(yaw - world.cam.want.yaw), Math.cos(yaw - world.cam.want.yaw));
  if (Math.abs(off) > Math.PI / 5) world.cam.want.yaw = yaw;
}

// Direction to the furthest point along the hole (its route round any
// corners, then the cup) that the ball can see without a rail in the way.
// Null when none is in sight.
function lookYaw() {
  const hole = holes[game.holeIndex];
  const { x, z } = game.sim.ball;
  const targets = [...(hole.route || []), hole.cup];
  for (let i = targets.length - 1; i >= 0; i--) {
    const [tx, tz] = targets[i];
    if (Math.hypot(tx - x, tz - z) < 0.5) continue;
    if (game.sim.walls.every(w => !segmentsCross(x, z, tx, tz, w))) return Math.atan2(tx - x, tz - z);
  }
  return null;
}

function segmentsCross(ax, az, bx, bz, w) {
  const side = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = side(w.x1, w.z1, w.x2, w.z2, ax, az), d2 = side(w.x1, w.z1, w.x2, w.z2, bx, bz);
  const d3 = side(ax, az, bx, bz, w.x1, w.z1), d4 = side(ax, az, bx, bz, w.x2, w.z2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function onPhysicsEvent(ev) {
  const b = game.sim.ball;
  if (ev.type === 'cup') {
    game.sink = { x: b.x, z: b.z, t: 0 };
    b.vx = b.vz = 0;
    sfx.cup();
    const hole = holes[game.holeIndex];
    if (game.strokes <= hole.par) world.confetti(...hole.cup);
    // Fireworks for finishing the round.
    if (!game.onBonus && game.stage === STAGES - 1) world.fireworks(...hole.cup);
    finishHole(game.strokes);
  } else if (ev.type === 'water' || ev.type === 'fall') {
    // Same penalty for both: +1 stroke, back to where you played from.
    game.mode = 'splash';
    game.timer = 1.1;
    game.splashAt = { x: b.x, z: b.z, fall: ev.type === 'fall' };
    b.vx = b.vz = 0;
    if (ev.type === 'water') {
      world.splash(b.x, b.z);
      sfx.splash();
      toast('Splash! +1 stroke');
    } else {
      sfx.fall();
      toast(ev.off ? 'Over the side! +1 stroke' : 'Down the gap! +1 stroke');
    }
    game.strokes++;
    updateHud();
  } else if (ev.type === 'lost') {
    game.sim.place(...game.lastRest);
    game.mode = 'aim';
    toast('Out of bounds: back you go');
  }
}

world.onFirework = () => sfx.firework();

let lastHitSound = 0;
function onHit(speed, x, z, what) {
  if (what && what.what === 'bumper') {
    world.bumperHit(what.index);
    sfx.bumper();
    return;
  }
  const now = performance.now();
  if (now - lastHitSound > 60) {
    lastHitSound = now;
    sfx.hit(speed);
  }
}

export function physicsStep() {
  const sim = game.sim;
  if (game.mode === 'aim' || game.mode === 'rolling' || game.mode === 'title') {
    const warps = sim.warps;
    const ev = sim.step(onHit);
    if (sim.warps !== warps && game.mode !== 'title') {
      const p = (sim.hole.pipes || []).find(q => Math.hypot(sim.ball.x - q.to[0], sim.ball.z - q.to[1]) < 1);
      if (p) {
        world.warpPuff(...p.from);
        world.warpPuff(...p.to);
      }
      sfx.warp();
    }
    if (ev) {
      if (game.mode === 'title') sim.place(...holes[game.holeIndex].tee);
      else onPhysicsEvent(ev);
      return;
    }
    // Something (a sliding block) knocked the ball while you were aiming.
    if (game.mode === 'aim' && sim.moving) {
      game.mode = 'rolling';
      world.hideAim();
      cancelDrag();
    }
    if (game.mode === 'rolling' && sim.restTime > SETTLE_TIME) {
      sim.ball.vx = sim.ball.vz = 0;
      ballReady();
    }
  } else {
    sim.t += STEP;
  }
}

// Where to draw the ball (it leaves the physics when it drops in or splashes).
export const ballPos = new Vector3();
let frostTimer = 0, hissCount = 0;
export const ballVel = { x: 0, z: 0 };
export function placeBall(dt) {
  const sim = game.sim, b = sim.ball, terrain = game.terrain;
  ballVel.x = b.vx;
  ballVel.z = b.vz;
  if (game.sink) {
    const s = game.sink;
    s.t += dt;
    const [cx, cz] = holes[game.holeIndex].cup;
    const k = smooth(s.t / 0.18);
    const x = s.x + (cx - s.x) * k, z = s.z + (cz - s.z) * k;
    const drop = Math.min(0.24, 3.5 * s.t * s.t);
    ballPos.set(x, terrain.cupLevel + BALL_R - drop, z);
    ballVel.x = ballVel.z = 0;
    return;
  }
  if (game.mode === 'splash') {
    game.timer -= dt;
    const s = game.splashAt;
    // Sinks into the water, or drops down the gap.
    const sink = s.fall ? Math.min(2, 4.9 * (1.1 - game.timer) ** 2) : Math.min(0.5, (1.1 - game.timer) * 0.8);
    ballPos.set(s.x, terrain.height(s.x, s.z) + BALL_R - sink, s.z);
    if (game.timer <= 0) {
      sim.place(...game.lastRest);
      ballReady();
    }
    return;
  }
  // Frost and a faint hiss behind a ball sliding on ice.
  const surface = terrain.surfaceAt(b.x, b.z);
  if (game.mode === 'rolling' && sim.speed > 0.3 && (surface === 'ice' || surface === 'frost')) {
    frostTimer -= dt;
    if (frostTimer <= 0) {
      frostTimer = 0.07;
      world.frost(b.x, b.z);
      if ((hissCount = (hissCount + 1) % 4) === 0) sfx.ice(sim.speed);
    }
  }

  // Over a gap the ball flies in an arc from one lip to the other.
  let lift = 0;
  if (sim.air) {
    const { from, to } = sim.air;
    const f = Math.max(0, Math.min(1, (b.z - from) / (to - from)));
    lift = 4 * 0.35 * f * (1 - f);
  }
  ballPos.set(b.x, terrain.height(b.x, b.z) + BALL_R + lift, b.z);
}
