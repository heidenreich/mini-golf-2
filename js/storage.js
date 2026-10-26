// What's kept between visits: best round and settings, and the round in
// progress.
import { game, holes } from './state.js';

const SAVE_KEY = 'minigolf2';
const ROUND_KEY = 'minigolf2-round';
const ROUND_TTL = 7 * 24 * 3600 * 1000;  // a round left this long starts afresh

// ---- Best round and settings ----------------------------------------------------

// Only trusts what it expects, so stray data in storage can't break the game.
export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    if (!Number.isFinite(d.best)) delete d.best;
    return d;
  } catch {
    return {};
  }
}

export function save(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private mode or storage blocked: scores just aren't kept.
  }
}

// ---- Saving the round in progress -------------------------------------------------

// Where you are in the round, so a reload can pick it up again. It goes in
// localStorage rather than sessionStorage: phones close installed apps in the
// background, and that throws sessionStorage away.
export function saveRound() {
  if (game.mode === 'title') return;
  try {
    localStorage.setItem(ROUND_KEY, JSON.stringify({
      hole: game.holeIndex, stage: game.stage, onBonus: game.onBonus, bonusPlayed: game.bonusPlayed,
      mulligans: game.mulligans,
      route: game.route.filter(r => r.score != null),
      at: Date.now(),
    }));
  } catch {
    // Storage blocked: a reload just starts a new round.
  }
}

export function savedRound() {
  try {
    const r = JSON.parse(localStorage.getItem(ROUND_KEY));
    if (!r || !holes[r.hole] || !Array.isArray(r.route)) return null;
    if (!Number.isFinite(r.at) || Date.now() - r.at > ROUND_TTL) return null;
    if (!r.route.every(q => holes[q.hole] && Number.isFinite(q.score))) return null;
    return r;
  } catch {
    return null;
  }
}

export function clearRound() {
  try {
    localStorage.removeItem(ROUND_KEY);
  } catch {
    // Nothing to clear.
  }
}
