// Aiming and looking round: pointer, touch, keyboard and the camera buttons.
import { $, canvas, game, world, holes } from './state.js';
import { powerColor } from './render.js';
import { ac } from './audio.js';
import { shoot, useMulligan } from './play.js';
import { showMenu, resumeGame, restartHole } from './main.js';

const CANCEL_PULL = 16;         // px: let go inside this and the putt is cancelled
const GRAB_TOUCH = 80;          // px round the ball where a finger starts a putt
const GRAB_MOUSE = 64;          // ...and a mouse; anywhere else turns the camera

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

export function showAim() {
  const { angle, power } = game.aim;
  const cancelling = drag && drag.pull < CANCEL_PULL;
  $('power').classList.toggle('cancel', !!cancelling);
  // The power bar takes the hole name's place while you aim.
  document.body.classList.toggle('aiming', !!cancelling || power > 0);
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
let aimDirty = false; // the aim changed; redrawn once per frame, not per pointer move

// Called once a frame. Redraws the aim if it changed, and keeps the aim dots
// in step with moving obstacles (a few times a second is enough, and saves
// phones a lot of work).
export function refreshAim(tick) {
  if (aimDirty || (tick && game.mode === 'aim' && game.aim.power > 0 && (game.sim.hole.spinners || game.sim.hole.movers))) {
    aimDirty = false;
    showAim();
  }
}

function fullPull() {
  return Math.max(130, Math.min(170, Math.min(innerWidth, innerHeight) * 0.33));
}

export function cancelDrag() {
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

function nearBall(x, y, pointerType) {
  const p = world.ballScreen();
  return Math.hypot(x - p.x, y - p.y) <= (pointerType === 'mouse' ? GRAB_MOUSE : GRAB_TOUCH);
}

// A dashed ring round the ball while you can putt, showing where to start.
export function updateGrabRing() {
  const ring = $('grab');
  const show = game.mode === 'aim' && !game.paused && !drag && !orbit && !$('overlay').classList.contains('show');
  ring.hidden = !show;
  if (!show) return;
  const p = world.ballScreen();
  const r = matchMedia('(pointer: coarse)').matches ? GRAB_TOUCH : GRAB_MOUSE;
  ring.style.width = ring.style.height = `${r * 2}px`;
  ring.style.transform = `translate(${p.x - r}px, ${p.y - r}px)`;
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
  // A drag that starts on the ball putts; anywhere else (or with two
  // fingers, or the right mouse button) turns the camera.
  const onBall = nearBall(e.clientX, e.clientY, e.pointerType);
  if (pointers.size >= 2 || e.button === 2 || e.button === 1 || !onBall || game.mode !== 'aim' || game.paused) {
    cancelDrag();
    orbitStart();
    return;
  }
  {
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
    aimDirty = true;
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
  $('cam-view-cap').textContent = on ? 'Follow' : 'Overview';
}

function faceFlag() {
  const [cx, cz] = holes[game.holeIndex].cup;
  const b = game.sim.ball;
  world.cam.want.yaw = Math.atan2(cx - b.x, cz - b.z);
  toggleOverview(false);
}

$('cam-view').addEventListener('click', () => toggleOverview());
$('mulligan').addEventListener('click', useMulligan);
$('cam-flag').addEventListener('click', faceFlag);
$('menu-btn').addEventListener('click', showMenu);
$('overlay').addEventListener('click', e => {
  if (e.target === $('overlay') && game.paused) resumeGame();
});

const keys = new Set();
window.addEventListener('keydown', e => {
  if ($('overlay').classList.contains('show')) {
    if (e.key === 'Escape' && game.paused) resumeGame();
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
  if (k === 'm') return useMulligan();
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

export function handleKeys(dt) {
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
