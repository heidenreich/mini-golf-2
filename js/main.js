// The flow of a round: title, holes, choosing a path, travelling between
// islands, menus and the main loop.
import { MAP, COURSE } from './courses.js';
import { THEMES } from './themes.js';
import { makeTerrain, insidePolygon } from './terrain.js';
import { Sim, STEP } from './physics.js';
import { $, canvas, world, holes, STAGES, MAX_STROKES, game, nextChoices, totals } from './state.js';
import { load, save, saveRound, savedRound, clearRound } from './storage.js';
import { ac, sfx, soundIsOn, setSound } from './audio.js';
import { toast, relName, scoreWord, updateHud, scorecardHtml, fade, bestText, showCard, hideCard, setPlaying, updateMulligan } from './ui.js';
import { mapSvg } from './map.js';
import { shoot, pickUp, physicsStep, ballPos, ballVel, placeBall } from './play.js';
import { cancelDrag, updateGrabRing, handleKeys, refreshAim } from './input.js';

// If the phone drops the 3D view (it can under memory pressure), say so and
// offer a reload; the round is saved, so it carries on from this island.
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  document.getElementById('card').innerHTML = `<h2>The graphics stopped</h2>
    <p>Your phone ran short of memory for the 3D view. Your round is saved: reload and you'll carry on from this island.</p>
    <div class="buttons"><button class="btn primary" onclick="location.reload()">Reload</button></div>`;
  document.getElementById('overlay').classList.add('show');
});

function showMap({ browse = false } = {}) {
  const choices = browse ? [] : nextChoices().filter(c => c.kind !== 'locked');
  const golden = choices.some(c => c.kind === 'gold');
  showCard(`
    <h2>${browse ? 'Course map' : 'Where next?'}</h2>
    <p class="sub">${browse ? 'Your route so far' : golden ? 'Your hole-in-one opened the golden bridge to the bonus island!' : 'Tap the island to cross to next.'}</p>
    ${mapSvg(choices)}
    <p class="legend"><span class="key gold"></span> A hole-in-one opens a golden bridge to the bonus island.</p>
    <div class="buttons">
      ${browse ? '<button class="btn primary" data-act="menu">Back</button>' : ''}
    </div>`);
  const first = $('card').querySelector('[data-go]');
  if (first) first.focus({ preventScroll: true });
}

// ---- Choosing a path -----------------------------------------------------------------

// The camera looks out over the bridges leading on, and a label floats
// over each one's signpost; tap one to cross.
function choosePath() {
  hideCard();
  setPlaying(false);
  game.mode = 'choose';
  world.lookAtBridges();
  // A locked golden bridge isn't labelled: its padlock and signpost say it
  // all, and a third label would crowd the two you can choose.
  $('paths').innerHTML = `<div class="paths-title">Choose your next island</div><svg class="path-leaders" aria-hidden="true"></svg>` + game.links.map((l, n) => {
    const h = holes[l.hole];
    const theme = (THEMES[h.theme] || THEMES.meadow).name;
    if (l.kind === 'locked') return '';
    return `<button class="path-choice ${l.kind === 'gold' ? 'gold' : ''}" data-n="${n}" data-go="${l.hole}">
      <b>${h.name}</b><span>Par ${h.par} &middot; ${l.kind === 'gold' ? 'bonus: win a mulligan' : theme}</span></button>`;
  }).join('');
  showPaths();
}

function showPaths() {
  const box = $('paths');
  box.hidden = false;
  // The menu button stays up so you can still pause, quit or turn the sound off.
  $('hud').hidden = false;
  placePathLabels();
  const first = box.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

// Keeps each label near its signpost as the camera moves, with a line down
// to the sign. Labels are spread apart until none overlap: sideways where
// there's room, otherwise up or down, always inside the screen.
function placePathLabels() {
  const box = $('paths');
  if (box.hidden) return;
  const spots = world.signsOnScreen();
  const W = innerWidth, H = innerHeight;
  const top = 116, bottom = H - 16, gap = 10;
  const items = [...box.querySelectorAll('.path-choice')].map(el => ({ el, p: spots[Number(el.dataset.n)], w: el.offsetWidth, h: el.offsetHeight }))
    .filter(it => it.p);
  const clampX = it => Math.max(it.w / 2 + 8, Math.min(W - it.w / 2 - 8, it.x));
  const clampY = it => Math.max(top + it.h, Math.min(bottom, it.y));
  // x is the label's centre, y its bottom edge: start just above the sign.
  for (const it of items) {
    it.x = it.p.x;
    it.y = it.p.y - 24;
    it.x = clampX(it);
    it.y = clampY(it);
  }
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + gap - Math.abs((a.y - a.h / 2) - (b.y - b.h / 2));
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const [l, r] = a.x <= b.x ? [a, b] : [b, a];
        const [hi, lo] = a.y <= b.y ? [a, b] : [b, a];
        // Sideways if both still fit on screen, else apart vertically.
        if (l.x - ox / 2 >= l.w / 2 + 8 && r.x + ox / 2 <= W - r.w / 2 - 8 && ox <= oy * 1.5) {
          l.x -= ox / 2;
          r.x += ox / 2;
        } else if (hi.y - hi.h - oy >= top) {
          hi.y -= oy;
        } else {
          lo.y = Math.min(bottom, lo.y + oy);
          hi.y = clampY({ ...hi, y: hi.y - oy });
        }
      }
    }
    if (!moved) break;
  }
  const lines = [];
  for (const it of items) {
    const show = it.p.visible;
    it.el.style.visibility = show ? 'visible' : 'hidden';
    it.el.style.transform = `translate(-50%, -100%) translate(${Math.round(it.x)}px, ${Math.round(it.y)}px)`;
    if (show && Math.hypot(it.p.x - it.x, it.p.y - it.y) > 14) {
      lines.push(`<line x1="${it.x.toFixed(0)}" y1="${it.y.toFixed(0)}" x2="${it.p.x.toFixed(0)}" y2="${it.p.y.toFixed(0)}"/><circle cx="${it.p.x.toFixed(0)}" cy="${it.p.y.toFixed(0)}" r="5"/>`);
    }
  }
  box.querySelector('.path-leaders').innerHTML = lines.join('');
}

$('paths').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) travelTo(Number(go.dataset.go));
});

// ---- Travelling ----------------------------------------------------------------------

// Off along this island's bridge to `hole`, then in along the next one's.
function travelTo(hole) {
  const n = game.links.findIndex(l => l.hole === hole);
  $('paths').hidden = true;
  hideCard();
  setPlaying(false);
  game.mode = 'travel';
  const arrive = () => {
    const bonus = hole === MAP.bonus.hole;
    if (bonus) {
      game.onBonus = true;
      game.bonusPlayed = true;
    } else {
      game.onBonus = false;
      game.stage += 1;
    }
    enterHole(hole);
  };
  world.flyOut(n, arrive, () => fade(true));
}

// Builds the hole and flies in across its bridge.
// `resume`: a saved round, to put the ball and strokes back where they were
// (or, if this hole was finished, back on its end-of-hole card).
function enterHole(hole, resume = null) {
  startHole(hole, { quiet: true });
  game.mode = 'travel';
  const done = game.route.find(r => r.hole === hole && r.score != null);
  if (resume && !done) {
    game.strokes = resume.strokes;
    const b = resume.ball;
    if (b && insidePolygon(holes[hole].shape, b[0], b[1])) {
      game.sim.place(b[0], b[1]);
      game.lastRest = [b[0], b[1]];
      world.cam.target.set(b[0], game.terrain.height(b[0], b[1]), b[1]);
    }
    updateHud();
    saveRound();
  }
  setPlaying(false);
  fade(false);
  world.flyIn(() => {
    if (done) {
      setPlaying(true);
      return finishHole(done.score, '', { resumed: true });
    }
    game.mode = 'aim';
    setPlaying(true);
    const h = holes[hole];
    const label = game.onBonus ? 'Bonus island' : `Hole ${game.stage + 1}`;
    toast(`${label} &middot; ${h.name} &middot; Par ${h.par}${h.tip ? `<small>${h.tip}</small>` : ''}`, 3800);
    $('hint').hidden = game.stage !== 0 || game.onBonus;
  });
}

function resumeRound() {
  const r = savedRound();
  if (!r) return startRound();
  game.route = r.route;
  game.stage = r.stage;
  game.onBonus = r.onBonus;
  game.bonusPlayed = r.bonusPlayed;
  game.mulligans = r.mulligans;
  game.mode = 'travel';
  hideCard();
  enterHole(r.hole, r);
}

// ---- Screens ---------------------------------------------------------------------

function showTitle() {
  game.mode = 'title';
  $('paths').hidden = true;
  world.releaseBridges();
  game.paused = false;
  setPlaying(false);
  fade(false);
  $('hint').hidden = true;
  game.route = [];
  game.stage = 0;
  game.onBonus = false;
  startHole(MAP.stages[0][0], { quiet: true });
  game.mode = 'title';
  world.cam.overview = true;
  world.showMarker = false;
  const best = bestText(load());
  const resume = savedRound();
  showCard(`
    <h1>Mini Golf <span class="two">2</span></h1>
    <p class="sub">${COURSE.name} &middot; ${holes.length} islands &middot; ${STAGES} holes a round</p>
    ${best ? `<p>${best}</p>` : ''}
    <div class="buttons">
      ${resume ? `<button class="btn primary" data-act="resume-round">Continue round (${resume.onBonus ? 'bonus island' : `hole ${resume.stage + 1}`}: ${holes[resume.hole].name})</button>` : ''}
      <button class="btn ${resume ? '' : 'primary'}" data-act="play">${resume ? 'New round' : 'Play'}</button>
      <button class="btn" data-act="sound">Sound: ${soundIsOn() ? 'on' : 'off'}</button>
    </div>
    <ul class="how">
      <li>Drag back from the ball and let go to putt. Pull further for more power.</li>
      <li>Drag anywhere else to look round. Pinch to zoom.</li>
      <li>After each hole, choose which island to cross to next. A hole-in-one opens a golden bridge to a bonus island.</li>
    </ul>`, { clear: true });
}

function startRound() {
  clearRound();
  game.route = [];
  game.stage = 0;
  game.onBonus = false;
  game.bonusPlayed = false;
  game.mulligans = 0;
  game.mode = 'travel';   // not 'title', so hole 1 is saved
  hideCard();
  enterHole(MAP.stages[0][0]);
}

function startHole(i, { quiet = false, keepStrokes = false } = {}) {
  game.holeIndex = i;
  const hole = holes[i];
  game.terrain = makeTerrain(hole);
  game.sim = new Sim(hole, game.terrain);
  if (!keepStrokes) game.strokes = 0;
  game.lastRest = [...hole.tee];
  game.sink = null;
  game.doneCard = '';
  game.undo = null;
  game.aim = { angle: 0, power: 0, keyboard: false };
  if (!keepStrokes && !game.route.some(r => r.hole === i)) game.route.push({ hole: i, stage: game.stage, bonus: !!game.onBonus, score: null });
  game.links = nextChoices();
  saveRound();
  world.buildHole(hole, game.terrain, i, {
    outs: game.links.map(l => ({ kind: l.kind, name: holes[l.hole].name, par: holes[l.hole].par })),
  });

  const look = hole.look || hole.cup;
  const yaw = Math.atan2(look[0] - hole.tee[0], look[1] - hole.tee[1]);
  const view = world.defaultView();
  Object.assign(world.cam, { yaw, ...view, overview: false });
  Object.assign(world.cam.want, { yaw, ...view });
  world.cam.target.set(hole.tee[0], game.terrain.height(...hole.tee), hole.tee[1]);
  $('cam-view').setAttribute('aria-pressed', 'false');
  $('cam-view-cap').textContent = 'Overview';
  world.showMarker = true;

  game.mode = 'aim';
  updateHud();
  if (!quiet) {
    toast(`Hole ${game.stage + 1} &middot; ${hole.name} &middot; Par ${hole.par}${hole.tip ? `<small>${hole.tip}</small>` : ''}`, 3800);
    $('hint').hidden = game.stage !== 0;
  }
}

export function finishHole(score, note = '', { resumed = false } = {}) {
  const r = game.route.find(q => q.hole === game.holeIndex);
  if (r) r.score = score;
  game.mode = 'done';
  game.undo = null;
  saveRound();
  const hole = holes[game.holeIndex];
  // Par or better on the bonus island wins a mulligan.
  let bonusNote = '';
  if (game.onBonus) {
    const won = score <= hole.par;
    if (won) game.mulligans = 1;
    bonusNote = `<p class="bonus-note">${won ? '<b>You won a mulligan!</b> Tap the golden ball after a bad putt to take it again.' : 'No mulligan this time.'}
      ${score < hole.par ? ' And your hole-in-one comes off your score.' : ' This hole doesn\'t count against your score.'}</p>`;
  }
  updateHud();
  const last = !game.onBonus && game.stage === STAGES - 1;
  const d = score - hole.par;
  if (!resumed && (d < 0 || score === 1)) sfx.cheer(score === 1 ? 3 : -d);
  // A hole-in-one opens the way to the bonus island.
  game.links = nextChoices();
  if (game.links.some(l => l.kind === 'gold')) {
    world.unlockGold();
    bonusNote = '<p class="bonus-note"><b>The golden bridge is open!</b> Cross it to the bonus island, where par or better wins a mulligan.</p>';
  }
  // With only one island to go to, skip the map and head straight there.
  const open = game.links.filter(l => l.kind !== 'locked');
  const only = open.length === 1 ? open[0].hole : null;
  const nextButton = last
    ? '<button class="btn primary" data-act="final">See your score</button>'
    : only != null
      ? `<button class="btn primary" data-go="${only}">Next hole: ${holes[only].name}</button>`
      : '<button class="btn primary" data-act="paths">Choose your path</button>';
  setTimeout(() => {
    if (game.mode !== 'done') return;
    game.doneCard = `
      <h2>${note || scoreWord(score, hole.par)}</h2>
      <p class="sub">${game.onBonus ? 'Bonus island' : `Hole ${game.stage + 1}`} &middot; ${hole.name} &middot; ${score} stroke${score === 1 ? '' : 's'}</p>
      ${bonusNote}
      ${scorecardHtml()}
      <div class="buttons">${nextButton}<button class="btn" data-act="menu">Menu</button></div>`;
    if (!game.paused) showCard(game.doneCard);
  }, resumed ? 0 : score === 1 ? 1600 : 1000);
}

function showFinal() {
  game.mode = 'final';
  clearRound();
  setPlaying(false);
  const t = totals();
  const data = load();
  const isBest = !Number.isFinite(data.bestToPar) || t.diff < data.bestToPar;
  if (isBest) {
    data.bestToPar = t.diff;
    data.best = t.strokes;
    save(data);
  }
  world.cam.overview = true;
  world.showMarker = false;
  // Score, scorecard and buttons first, then the map of your route: side by
  // side on a big screen, one under the other on a phone.
  showCard(`
    <div class="final-score">
      <h2>Round complete</h2>
      <div class="big">${t.strokes}</div>
      <p>${relName(t.diff)} against par ${t.par} for your route</p>
      ${isBest ? '<p class="new-best">New best round!</p>' : `<p class="sub">${bestText(data)}</p>`}
      ${scorecardHtml()}
      <div class="buttons">
        <button class="btn primary" data-act="play">Play again</button>
        <button class="btn" data-act="title">Title screen</button>
      </div>
    </div>
    <div class="final-map">${mapSvg()}</div>`, { wide: true });
}

// Opens from play, from the end-of-hole card or while choosing a path, and
// Resume goes back to whichever it was.
export function showMenu() {
  if (!game.paused) {
    if (['aim', 'rolling'].includes(game.mode)) game.menuFrom = null;
    else if (game.mode === 'done' && game.doneCard) game.menuFrom = 'done';
    else if (game.mode === 'choose') game.menuFrom = 'choose';
    else return;
  }
  game.paused = true;
  cancelDrag();
  $('paths').hidden = true;
  const playing = game.menuFrom === null;
  showCard(`
    <h2>Paused</h2>
    <p class="sub">${game.onBonus ? 'Bonus island' : `Hole ${game.stage + 1}`} &middot; ${holes[game.holeIndex].name}</p>
    ${scorecardHtml()}
    <div class="buttons">
      <button class="btn primary" data-act="resume">${playing ? 'Resume' : 'Back'}</button>
      <button class="btn" data-act="map-browse">Course map</button>
      ${playing ? '<button class="btn" data-act="restart">Back to the tee (strokes kept)</button>' : ''}
      <button class="btn" data-act="sound">Sound: ${soundIsOn() ? 'on' : 'off'}</button>
      <button class="btn" data-act="title">Quit to title</button>
    </div>`);
}

export function resumeGame() {
  game.paused = false;
  if (game.menuFrom === 'done') return showCard(game.doneCard);
  hideCard();
  if (game.menuFrom === 'choose') showPaths();
}

$('card').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) return travelTo(Number(go.dataset.go));
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  ac();
  const act = btn.dataset.act;
  if (act === 'play') startRound();
  else if (act === 'resume-round') resumeRound();
  else if (act === 'map') showMap();
  else if (act === 'paths') choosePath();
  else if (act === 'map-browse') showMap({ browse: true });
  else if (act === 'menu') showMenu();
  else if (act === 'final') showFinal();
  else if (act === 'title') showTitle();
  else if (act === 'resume') resumeGame();
  else if (act === 'restart') { hideCard(); game.paused = false; restartHole(); }
  else if (act === 'sound') {
    setSound(!soundIsOn());
    btn.textContent = `Sound: ${soundIsOn() ? 'on' : 'off'}`;
  }
});
// Map islands are SVG, so Enter and Space need wiring up by hand.
$('card').addEventListener('keydown', e => {
  const go = e.target.closest && e.target.closest('[data-go]');
  if (go && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    travelTo(Number(go.dataset.go));
  }
});

// Puts the ball back on the tee. Strokes so far still count, so it's a
// way out of a bad spot rather than a free do-over.
export function restartHole() {
  if (game.mode !== 'aim' && game.mode !== 'rolling') return;
  game.paused = false;
  hideCard();
  startHole(game.holeIndex, { quiet: true, keepStrokes: true });
  if (game.strokes >= MAX_STROKES) pickUp();
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
window.addEventListener('resize', () => { resize(); stillFor = 0; });
resize();

let last = performance.now();
let acc = 0;
let aimTick = 0;
let stillFor = 0;  // seconds paused; once the camera has settled, stop redrawing
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
  aimTick = (aimTick + 1) % 4;
  refreshAim(aimTick === 0);
  // Nothing moves while paused, so after a moment for the camera to settle
  // the picture stays as it is: saves battery behind the pause menu.
  stillFor = game.paused ? stillFor + dt : 0;
  if (stillFor < 0.6) {
    world.update(game.paused ? 0 : dt, game.sim, ballPos, ballVel);
    world.updateCamera(dt, ballPos);
    world.render();
  }
  updateGrabRing();
  updateMulligan();
  if (game.mode === 'choose') placePathLabels();
  requestAnimationFrame(frame);
}

showTitle();
requestAnimationFrame(frame);

// Installable and playable offline.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// For debugging and automated tests.
window.miniGolf2 = {
  game, world, holes,
  shoot: (angle, power) => shoot(angle, power),
  startRound,
  // Jumps straight to a hole (for tests): the stage is taken from the map.
  startHole: i => {
    hideCard();
    setPlaying(true);
    fade(false);
    const stage = MAP.stages.findIndex(opts => opts.includes(i));
    game.onBonus = stage < 0;
    if (stage >= 0) game.stage = stage;
    startHole(i);
  },
  travelTo,
  MAP,
};

