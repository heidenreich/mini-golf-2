import { Vector3 } from '../vendor/three.module.min.js';
import { COURSE } from './courses.js';
import { makeTerrain, smooth } from './terrain.js';
import { Sim, STEP, BALL_R, REST_SPEED } from './physics.js';
import { World, powerColor } from './render.js';

const MAX_STROKES = 8;          // picked up after this many
const SETTLE_TIME = 0.3;        // a roll ends once the ball has been still this long
const CANCEL_PULL = 16;         // px: let go inside this and the putt is cancelled
const SAVE_KEY = 'minigolf2';

const $ = id => document.getElementById(id);
const canvas = $('game');
let world;
try {
  world = new World(canvas);
} catch (err) {
  document.getElementById('card').innerHTML = `<h2>Mini Golf 2 can't run here</h2>
    <p>It needs WebGL, which this browser has turned off or doesn't support.
    Try another browser, or turn on hardware acceleration in this one's settings.</p>`;
  document.getElementById('overlay').classList.add('show');
  throw err;
}
const holes = COURSE.holes;
const coursePar = holes.reduce((s, h) => s + h.par, 0);

const game = {
  mode: 'title',        // title | aim | rolling | splash | done | final
  holeIndex: 0,
  strokes: 0,
  scores: [],
  sim: null,
  terrain: null,
  lastRest: [0, 0],
  aim: { angle: 0, power: 0, keyboard: false },
  timer: 0,
  sink: null,
  paused: false,
};

// ---- Saving -----------------------------------------------------------------

// Only trusts what it expects, so stray data in storage can't break the game.
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    if (!Number.isFinite(d.best)) delete d.best;
    return d;
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private mode or storage blocked: scores just aren't kept.
  }
}

const saved = load();
let soundOn = saved.sound !== false;

// ---- Sound --------------------------------------------------------------------

let audio = null;

function ac() {
  if (!soundOn) return null;
  if (!audio) {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (audio.state !== 'running') audio.resume().catch(() => {});
  return audio;
}

function tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.2, freq = 1200, q = 1, at = 0, type = 'bandpass' } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const len = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

const sfx = {
  putt(p) {
    noise(0.05, { vol: 0.25 + p * 0.3, freq: 2600, q: 2 });
    tone(950, 0.06, { vol: 0.12 + p * 0.1, type: 'triangle' });
  },
  hit(speed) {
    const v = Math.min(1, speed / 6);
    tone(180 + v * 120, 0.09, { vol: 0.08 + v * 0.25, type: 'triangle', slide: 0.6 });
    noise(0.04, { vol: 0.08 + v * 0.15, freq: 900, q: 1 });
  },
  cup() {
    tone(640, 0.12, { vol: 0.2, type: 'triangle', slide: 0.7 });
    noise(0.12, { vol: 0.2, freq: 1800, q: 3, at: 0.08 });
    tone(420, 0.18, { vol: 0.2, type: 'triangle', at: 0.15, slide: 0.8 });
  },
  splash() {
    noise(0.5, { vol: 0.35, freq: 700, q: 0.6, type: 'lowpass' });
    tone(300, 0.25, { vol: 0.08, slide: 0.4 });
  },
  cheer(level) {
    const notes = [523, 659, 784, 1047, 1319];
    const n = Math.min(notes.length, 2 + level);
    for (let i = 0; i < n; i++) tone(notes[i], 0.22, { vol: 0.14, type: 'triangle', at: i * 0.09 });
  },
};

// ---- UI helpers ----------------------------------------------------------------

let toastTimer = 0;
function toast(html, ms = 2200) {
  const el = $('toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function relName(diff) {
  return diff === 0 ? 'Even' : diff > 0 ? `+${diff}` : `${diff}`;
}

function scoreWord(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || `${relName(d)}`;
}

function totals() {
  let strokes = 0, par = 0;
  game.scores.forEach((s, i) => {
    if (s != null) {
      strokes += s;
      par += holes[i].par;
    }
  });
  return { strokes, par, diff: strokes - par };
}

function updateHud() {
  const hole = holes[game.holeIndex];
  $('hud-hole').textContent = game.holeIndex + 1;
  $('hud-holes').textContent = holes.length;
  $('hud-par').textContent = hole.par;
  $('hud-strokes').textContent = Math.min(game.strokes, MAX_STROKES);
  $('hud-name').textContent = hole.name;
  const t = totals();
  $('hud-total').textContent = relName(t.diff);
  const chip = $('hud-total-chip');
  chip.classList.toggle('under', t.diff < 0);
  chip.classList.toggle('over', t.diff > 0);
}

function scorecardHtml(current = -1) {
  const cell = (i) => {
    const s = game.scores[i];
    if (s == null) return `<td class="${i === current ? 'current' : ''}">&middot;</td>`;
    const d = s - holes[i].par;
    return `<td class="${d < 0 ? 'under' : d > 0 ? 'over' : ''} ${i === current ? 'current' : ''}">${s}</td>`;
  };
  const t = totals();
  return `<table class="scorecard">
    <tr><th>Hole</th>${holes.map((_, i) => `<th>${i + 1}</th>`).join('')}<th>Tot</th></tr>
    <tr><th>Par</th>${holes.map(h => `<td>${h.par}</td>`).join('')}<td>${coursePar}</td></tr>
    <tr><th>You</th>${holes.map((_, i) => cell(i)).join('')}<td><b>${t.strokes || '&middot;'}</b></td></tr>
  </table>`;
}

// While a card is up, the game controls behind it are out of reach.
function setInert(on) {
  for (const id of ['hud', 'cam-controls', 'game']) $(id).inert = on;
}

function showCard(html, { clear = false } = {}) {
  $('card').innerHTML = html;
  const ov = $('overlay');
  ov.classList.add('show');
  ov.classList.toggle('clear', clear);
  setInert(true);
  const first = $('card').querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

function hideCard() {
  $('overlay').classList.remove('show');
  setInert(false);
}

function setPlaying(on) {
  $('hud').hidden = !on;
  $('cam-controls').hidden = !on;
}

// ---- Screens ---------------------------------------------------------------------

function showTitle() {
  game.mode = 'title';
  game.paused = false;
  setPlaying(false);
  $('hint').hidden = true;
  startHole(0, { quiet: true });
  game.mode = 'title';
  world.cam.overview = true;
  world.showMarker = false;
  const best = load().best;
  showCard(`
    <h1>Mini Golf <span class="two">2</span></h1>
    <p class="sub">${COURSE.name} &middot; ${holes.length} holes &middot; par ${coursePar}</p>
    ${best != null ? `<p>Best round: <b>${best}</b> (${relName(best - coursePar)})</p>` : ''}
    <div class="buttons">
      <button class="btn primary" data-act="play">Play</button>
      <button class="btn" data-act="sound">Sound: ${soundOn ? 'on' : 'off'}</button>
    </div>
    <ul class="how">
      <li>Drag back from anywhere and let go to putt. Pull further for more power.</li>
      <li>Slopes are real: the ball curves and rolls back down hills.</li>
      <li>Look round with two fingers (or right-drag, Q/E), or tap the overview button.</li>
    </ul>`, { clear: true });
}

function startRound() {
  game.scores = holes.map(() => null);
  hideCard();
  setPlaying(true);
  startHole(0);
}

function startHole(i, { quiet = false, keepStrokes = false } = {}) {
  game.holeIndex = i;
  const hole = holes[i];
  game.terrain = makeTerrain(hole);
  game.sim = new Sim(hole, game.terrain);
  if (!keepStrokes) game.strokes = 0;
  game.lastRest = [...hole.tee];
  game.sink = null;
  game.aim = { angle: 0, power: 0, keyboard: false };
  world.buildHole(hole, game.terrain, i);

  const look = hole.look || hole.cup;
  const yaw = Math.atan2(look[0] - hole.tee[0], look[1] - hole.tee[1]);
  const view = world.defaultView();
  Object.assign(world.cam, { yaw, ...view, overview: false });
  Object.assign(world.cam.want, { yaw, ...view });
  world.cam.target.set(hole.tee[0], game.terrain.height(...hole.tee), hole.tee[1]);
  $('cam-view').setAttribute('aria-pressed', 'false');
  world.showMarker = true;

  game.mode = 'aim';
  updateHud();
  if (!quiet) {
    toast(`Hole ${i + 1} &middot; ${hole.name} &middot; Par ${hole.par}${hole.tip ? `<small>${hole.tip}</small>` : ''}`, 3800);
    $('hint').hidden = i !== 0;
  }
}

function finishHole(score, note = '') {
  game.scores[game.holeIndex] = score;
  game.mode = 'done';
  updateHud();
  const hole = holes[game.holeIndex];
  const last = game.holeIndex === holes.length - 1;
  const d = score - hole.par;
  if (d < 0 || score === 1) sfx.cheer(score === 1 ? 3 : -d);
  setTimeout(() => {
    if (game.mode !== 'done') return;
    showCard(`
      <h2>${note || scoreWord(score, hole.par)}</h2>
      <p class="sub">Hole ${game.holeIndex + 1} &middot; ${hole.name} &middot; ${score} stroke${score === 1 ? '' : 's'}</p>
      ${scorecardHtml(game.holeIndex)}
      <div class="buttons">
        <button class="btn primary" data-act="${last ? 'final' : 'next'}">${last ? 'See your score' : 'Next hole'}</button>
      </div>`);
  }, score === 1 ? 1600 : 1000);
}

function showFinal() {
  game.mode = 'final';
  setPlaying(false);
  const t = totals();
  const data = load();
  const isBest = data.best == null || t.strokes < data.best;
  if (isBest) {
    data.best = t.strokes;
    save(data);
  }
  world.cam.overview = true;
  world.showMarker = false;
  showCard(`
    <h2>Round complete</h2>
    <div class="big">${t.strokes}</div>
    <p>${relName(t.diff)} against par ${coursePar}</p>
    ${isBest ? '<p class="new-best">New best round!</p>' : `<p class="sub">Best round: ${data.best}</p>`}
    ${scorecardHtml()}
    <div class="buttons">
      <button class="btn primary" data-act="play">Play again</button>
      <button class="btn" data-act="title">Title screen</button>
    </div>`);
}

function showMenu() {
  if (!['aim', 'rolling'].includes(game.mode)) return;
  game.paused = true;
  cancelDrag();
  showCard(`
    <h2>Paused</h2>
    <p class="sub">Hole ${game.holeIndex + 1} &middot; ${holes[game.holeIndex].name}</p>
    ${scorecardHtml(game.holeIndex)}
    <div class="buttons">
      <button class="btn primary" data-act="resume">Resume</button>
      <button class="btn" data-act="restart">Back to the tee</button>
      <button class="btn" data-act="sound">Sound: ${soundOn ? 'on' : 'off'}</button>
      <button class="btn" data-act="title">Quit to title</button>
    </div>`);
}

$('card').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  ac();
  const act = btn.dataset.act;
  if (act === 'play') startRound();
  else if (act === 'next') { hideCard(); startHole(game.holeIndex + 1); }
  else if (act === 'final') showFinal();
  else if (act === 'title') showTitle();
  else if (act === 'resume') { hideCard(); game.paused = false; }
  else if (act === 'restart') { hideCard(); game.paused = false; restartHole(); }
  else if (act === 'sound') {
    soundOn = !soundOn;
    const data = load();
    data.sound = soundOn;
    save(data);
    btn.textContent = `Sound: ${soundOn ? 'on' : 'off'}`;
  }
});

// Puts the ball back on the tee. Strokes so far still count, so it's a
// way out of a bad spot rather than a free do-over.
function restartHole() {
  if (game.mode !== 'aim' && game.mode !== 'rolling') return;
  game.paused = false;
  hideCard();
  startHole(game.holeIndex, { quiet: true, keepStrokes: true });
  if (game.strokes >= MAX_STROKES) pickUp();
}

// ---- Shots ------------------------------------------------------------------------

function shoot(angle, power) {
  if (game.mode !== 'aim' || game.paused || game.sim.moving) return;
  game.lastRest = [game.sim.ball.x, game.sim.ball.z];
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

function pickUp() {
  finishHole(MAX_STROKES, 'Picked up');
  toast(`Picked up after ${MAX_STROKES} strokes`);
}

// The ball is still again (after a putt, a splash or a knock).
function ballReady() {
  game.mode = 'aim';
  game.lastRest = [game.sim.ball.x, game.sim.ball.z];
  if (game.strokes >= MAX_STROKES) return pickUp();
  if (game.strokes === MAX_STROKES - 1) toast('Last stroke before the ball is picked up');
  // Turn to the flag if it has gone well out of view.
  const [cx, cz] = holes[game.holeIndex].cup;
  const toCup = Math.atan2(cx - game.sim.ball.x, cz - game.sim.ball.z);
  const off = Math.atan2(Math.sin(toCup - world.cam.want.yaw), Math.cos(toCup - world.cam.want.yaw));
  if (Math.abs(off) > Math.PI / 3 && !world.cam.overview) world.cam.want.yaw = toCup;
}

function onPhysicsEvent(ev) {
  const b = game.sim.ball;
  if (ev.type === 'cup') {
    game.sink = { x: b.x, z: b.z, t: 0 };
    b.vx = b.vz = 0;
    sfx.cup();
    const hole = holes[game.holeIndex];
    if (game.strokes <= hole.par) world.confetti(...hole.cup);
    finishHole(game.strokes);
  } else if (ev.type === 'water') {
    game.mode = 'splash';
    game.timer = 1.1;
    game.splashAt = { x: b.x, z: b.z };
    b.vx = b.vz = 0;
    world.splash(b.x, b.z);
    sfx.splash();
    game.strokes++;
    updateHud();
    toast('Splash! +1 stroke');
  } else if (ev.type === 'lost') {
    game.sim.place(...game.lastRest);
    game.mode = 'aim';
    toast('Out of bounds: back you go');
  }
}

let lastHitSound = 0;
function onHit(speed) {
  const now = performance.now();
  if (now - lastHitSound > 60) {
    lastHitSound = now;
    sfx.hit(speed);
  }
}

function physicsStep() {
  const sim = game.sim;
  if (game.mode === 'aim' || game.mode === 'rolling' || game.mode === 'title') {
    const ev = sim.step(onHit);
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
const ballPos = new Vector3();
const ballVel = { x: 0, z: 0 };
function placeBall(dt) {
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
    ballPos.set(s.x, terrain.height(s.x, s.z) + BALL_R - Math.min(0.5, (1.1 - game.timer) * 0.8), s.z);
    if (game.timer <= 0) {
      sim.place(...game.lastRest);
      ballReady();
    }
    return;
  }
  ballPos.set(b.x, terrain.height(b.x, b.z) + BALL_R, b.z);
}

// ---- Aiming -----------------------------------------------------------------------

function predictPath(angle, power) {
  const s = game.sim.clone();
  s.shoot(angle, power);
  const pts = [[s.ball.x, s.ball.z]];
  const maxLen = 1.2 + power * 3.3;
  let len = 0, hits = 0;
  let lx = s.ball.x, lz = s.ball.z;
  // Follows the roll through one bounce off a rail, and no further.
  for (let i = 0; i < 240 * 2 && hits < 2; i++) {
    const ev = s.step(() => { hits++; });
    const d = Math.hypot(s.ball.x - lx, s.ball.z - lz);
    if (d >= 0.11) {
      len += d;
      lx = s.ball.x;
      lz = s.ball.z;
      pts.push([lx, lz]);
      if (len > maxLen) break;
    }
    if (ev || !s.moving) break;
  }
  return pts.slice(1);
}

function showAim() {
  const { angle, power } = game.aim;
  const cancelling = drag && drag.pull < CANCEL_PULL;
  $('power').classList.toggle('cancel', !!cancelling);
  if (cancelling) {
    world.hideAim();
    $('power').hidden = false;
    $('power-fill').style.width = '0';
    $('power-text').textContent = 'Let go here to cancel';
    return;
  }
  if (power <= 0) {
    world.hideAim();
    $('power').hidden = true;
    return;
  }
  world.showAim(predictPath(angle, power), power);
  $('power').hidden = false;
  const fill = $('power-fill');
  fill.style.width = `${Math.round(power * 100)}%`;
  fill.style.background = `#${powerColor(power).getHexString()}`;
  $('power-text').textContent = `${Math.round(power * 100)}%`;
}

// ---- Input: pointer ---------------------------------------------------------------

const pointers = new Map();
let drag = null;     // one finger / left mouse: aiming a putt
let orbit = null;    // two fingers / right mouse: moving the camera

function fullPull() {
  return Math.max(130, Math.min(170, Math.min(innerWidth, innerHeight) * 0.33));
}

function cancelDrag() {
  drag = null;
  if (!game.aim.keyboard) {
    game.aim.power = 0;
    showAim();
  }
}

function resetPointers() {
  pointers.clear();
  orbit = null;
  cancelDrag();
}

function orbitStart() {
  const pts = [...pointers.values()];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const spread = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  orbit = { cx, cy, spread, yaw: world.cam.want.yaw, pitch: world.cam.want.pitch, dist: world.cam.want.dist };
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  ac();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // Some browsers refuse capture for synthetic or already-ended pointers.
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
  if (pointers.size >= 2 || e.button === 2 || e.button === 1) {
    cancelDrag();
    orbitStart();
    return;
  }
  if (game.mode === 'aim' && !game.paused) {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, pull: 0 };
    $('hint').hidden = true;
    $('toast').classList.remove('show');
    game.aim.keyboard = false;
  }
});

canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (orbit) {
    const pts = [...pointers.values()];
    const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
    const want = world.cam.want;
    want.yaw = orbit.yaw + (cx - orbit.cx) * 0.009;
    if (!world.cam.overview) {
      want.pitch = Math.max(0.15, Math.min(1.35, orbit.pitch + (cy - orbit.cy) * 0.005));
    }
    if (pts.length > 1 && orbit.spread > 0) {
      const spread = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      want.dist = Math.max(1.8, Math.min(12, (orbit.dist * orbit.spread) / Math.max(20, spread)));
    }
    return;
  }
  if (drag && drag.id === e.pointerId && game.mode === 'aim') {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const pull = Math.hypot(dx, dy);
    drag.pull = pull;
    if (pull < CANCEL_PULL) {
      game.aim.power = 0;
    } else {
      game.aim.power = Math.min(1, pull / fullPull());
      game.aim.angle = world.dragToAngle(dx, dy);
    }
    showAim();
  }
});

function pointerEnd(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (orbit) {
    if (pointers.size === 0) orbit = null;
    else orbitStart();
    return;
  }
  if (drag && drag.id === e.pointerId) {
    const { angle, power } = game.aim;
    const pull = drag.pull;
    drag = null;
    if (e.type === 'pointerup' && pull >= CANCEL_PULL && power > 0) shoot(angle, power);
    else cancelDrag();
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('lostpointercapture', pointerEnd);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetPointers(); });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const want = world.cam.want;
  want.dist = Math.max(1.8, Math.min(12, want.dist * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

// ---- Input: buttons and keys ------------------------------------------------------

let turning = 0;
function holdButton(id, dir) {
  const el = $(id);
  const stop = () => { turning = 0; };
  el.addEventListener('pointerdown', e => { e.preventDefault(); turning = dir; });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('click', e => {
    // Keyboard activation: one step.
    if (e.detail === 0) world.cam.want.yaw += dir * 0.35;
  });
}
holdButton('cam-left', 1);
holdButton('cam-right', -1);

function toggleOverview(force) {
  const on = force ?? !world.cam.overview;
  if (on === world.cam.overview) return;
  world.cam.overview = on;
  if (!on) {
    Object.assign(world.cam.want, world.defaultView());
  }
  $('cam-view').setAttribute('aria-pressed', String(on));
}

function faceFlag() {
  const [cx, cz] = holes[game.holeIndex].cup;
  const b = game.sim.ball;
  world.cam.want.yaw = Math.atan2(cx - b.x, cz - b.z);
  toggleOverview(false);
}

$('cam-view').addEventListener('click', () => toggleOverview());
$('cam-flag').addEventListener('click', faceFlag);
$('menu-btn').addEventListener('click', showMenu);
$('overlay').addEventListener('click', e => {
  if (e.target === $('overlay') && game.paused) {
    hideCard();
    game.paused = false;
  }
});

const keys = new Set();
window.addEventListener('keydown', e => {
  if ($('overlay').classList.contains('show')) {
    if (e.key === 'Escape' && game.paused) {
      hideCard();
      game.paused = false;
    }
    return;
  }
  // Let Space and Enter press a focused on-screen button.
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  ac();
  const k = e.key.toLowerCase();
  if (k === 'escape') return showMenu();
  if (k === 'r') return restartHole();
  if (k === 'v') return toggleOverview();
  if (k === 'f') return faceFlag();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter', 'q', 'e'].includes(k)) e.preventDefault();
  if ((k === ' ' || k === 'enter') && game.aim.keyboard && game.aim.power > 0) {
    return shoot(game.aim.angle, game.aim.power);
  }
  // A quick tap can come and go between frames, so the first press of an
  // arrow key takes effect here; holding it keeps going in handleKeys.
  if (KEY_NUDGE[k] && !keys.has(k) && game.mode === 'aim' && !game.paused) {
    startKeyboardAim();
    const fine = e.shiftKey ? 0.25 : 1;
    game.aim.angle += KEY_NUDGE[k][0] * fine;
    game.aim.power = Math.max(0, Math.min(1, game.aim.power + KEY_NUDGE[k][1] * fine));
    aimFromKeyboard();
  }
  keys.add(k);
});

// [angle, power] for one tap of each arrow key.
const KEY_NUDGE = {
  arrowleft: [0.03, 0], arrowright: [-0.03, 0],
  arrowup: [0, 0.02], arrowdown: [0, -0.02],
};

function startKeyboardAim() {
  if (game.aim.keyboard) return;
  game.aim.keyboard = true;
  game.aim.angle = world.cam.want.yaw;
  if (game.aim.power <= 0) game.aim.power = 0.3;
}

// The camera looks down the keyboard aim.
function aimFromKeyboard() {
  world.cam.want.yaw = game.aim.angle;
  toggleOverview(false);
  showAim();
}
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); turning = 0; resetPointers(); });

function handleKeys(dt) {
  if (keys.has('q')) world.cam.want.yaw += dt * 1.6;
  if (keys.has('e')) world.cam.want.yaw -= dt * 1.6;
  if (turning) world.cam.want.yaw += turning * dt * 1.6;
  if (game.mode !== 'aim' || game.paused) return;
  const fine = keys.has('shift') ? 0.25 : 1;
  let changed = false;
  const startKeyboard = () => {
    startKeyboardAim();
    changed = true;
  };
  if (keys.has('arrowleft')) { startKeyboard(); game.aim.angle += dt * 1.1 * fine; }
  if (keys.has('arrowright')) { startKeyboard(); game.aim.angle -= dt * 1.1 * fine; }
  if (keys.has('arrowup')) { startKeyboard(); game.aim.power = Math.min(1, game.aim.power + dt * 0.5 * fine); }
  if (keys.has('arrowdown')) { startKeyboard(); game.aim.power = Math.max(0, game.aim.power - dt * 0.5 * fine); }
  if (changed) aimFromKeyboard();
}

// ---- Main loop ----------------------------------------------------------------------

let wasPortrait = innerWidth < innerHeight;
function resize() {
  world.resize(innerWidth, innerHeight);
  // Turning the phone changes the best follow-camera framing.
  const portrait = innerWidth < innerHeight;
  if (portrait !== wasPortrait && !world.cam.overview) Object.assign(world.cam.want, world.defaultView());
  wasPortrait = portrait;
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let acc = 0;
let aimTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!game.paused) {
    handleKeys(dt);
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      physicsStep();
    }
    if (game.mode === 'title' || game.mode === 'final') world.cam.want.yaw += dt * 0.12;
  }
  placeBall(game.paused ? 0 : dt);
  // Keep the aim dots in step with moving obstacles (a few times a second
  // is enough, and saves phones a lot of work).
  aimTick = (aimTick + 1) % 4;
  if (aimTick === 0 && game.mode === 'aim' && game.aim.power > 0 && (game.sim.hole.spinners || game.sim.hole.movers)) showAim();
  world.update(game.paused ? 0 : dt, game.sim, ballPos, ballVel);
  world.updateCamera(dt, ballPos);
  world.render();
  requestAnimationFrame(frame);
}

showTitle();
requestAnimationFrame(frame);

// For debugging and automated tests.
window.miniGolf2 = {
  game, world, holes,
  shoot: (angle, power) => shoot(angle, power),
  startRound,
  startHole: i => { hideCard(); setPlaying(true); if (!game.scores.length) game.scores = holes.map(() => null); startHole(i); },
};
