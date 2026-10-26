// Shared by every part of the game: the 3D world, the course and the state
// of the round.
import { COURSE, MAP } from './courses.js';
import { World } from './render.js';

export const MAX_STROKES = 8;          // picked up after this many

export const $ = id => document.getElementById(id);
export const canvas = $('game');
export let world;
try {
  world = new World(canvas);
} catch (err) {
  document.getElementById('card').innerHTML = `<h2>Mini Golf 2 can't run here</h2>
    <p>It needs WebGL, which this browser has turned off or doesn't support.
    Try another browser, or turn on hardware acceleration in this one's settings.</p>`;
  document.getElementById('overlay').classList.add('show');
  throw err;
}
export const holes = COURSE.holes;
export const STAGES = MAP.stages.length;

export const game = {
  mode: 'title',        // title | aim | rolling | splash | done | travel | final
  holeIndex: 0,
  strokes: 0,
  route: [],            // holes played this round: { hole, stage, score }
  stage: 0,             // the stage being played (the bonus island keeps the stage before it)
  onBonus: false,
  bonusPlayed: false,
  mulligans: 0,         // won on the bonus island: retake one putt later in the round
  undo: null,           // where the last putt on this hole was played from: { x, z, strokes }
  links: [],            // where the bridges off this island lead: { hole, kind }
  sim: null,
  terrain: null,
  lastRest: [0, 0],
  aim: { angle: 0, power: 0, keyboard: false },
  timer: 0,
  sink: null,
  paused: false,
  menuFrom: null,       // where the pause menu was opened: null (playing) | 'done' | 'choose'
  doneCard: '',         // the end-of-hole card, to go back to from the menu
};

// Whether a hole's score goes into the round: the bonus island only counts
// if it helps (a birdie or better), so going there is never a risk.
export function counts(r) {
  return r.score != null && (!r.bonus || r.score < holes[r.hole].par);
}

// Strokes and par so far this round.
export function totals() {
  let strokes = 0, par = 0;
  for (const r of game.route) {
    if (!counts(r)) continue;
    strokes += r.score;
    par += holes[r.hole].par;
  }
  return { strokes, par, diff: strokes - par };
}

// Where you can go after the hole you're on.
export function nextChoices() {
  const out = [];
  const nextStage = game.stage + 1;
  if (nextStage < STAGES) for (const h of MAP.stages[nextStage]) out.push({ hole: h, kind: 'next' });
  if (!game.onBonus && !game.bonusPlayed && MAP.bonus.from.includes(game.stage)) {
    const r = game.route[game.route.length - 1];
    const ace = r && r.hole === game.holeIndex && r.score === 1;
    out.push({ hole: MAP.bonus.hole, kind: ace ? 'gold' : 'locked' });
  }
  return out;
}
