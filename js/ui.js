// The HTML on top of the 3D view: the HUD, banners, cards and scorecard.
import { $, game, holes, STAGES, MAX_STROKES, totals, counts } from './state.js';
import { MAP } from './courses.js';

let toastTimer = 0;
export function toast(html, ms = 2200) {
  const el = $('toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function relName(diff) {
  return diff === 0 ? 'Even' : diff > 0 ? `+${diff}` : `${diff}`;
}

export function scoreWord(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || `${relName(d)}`;
}

export function updateHud() {
  const hole = holes[game.holeIndex];
  $('hud-hole').textContent = game.onBonus ? '\u2605' : game.stage + 1;
  $('hud-holes').textContent = STAGES;
  $('hud-par').textContent = hole.par;
  $('hud-strokes').textContent = Math.min(game.strokes, MAX_STROKES);
  $('hud-name').textContent = hole.name;
  const t = totals();
  $('hud-total').textContent = relName(t.diff);
  const chip = $('hud-total-chip');
  chip.classList.toggle('under', t.diff < 0);
  chip.classList.toggle('over', t.diff > 0);
}

// One column per stage, plus the bonus island if you went there.
export function scorecardHtml() {
  const played = stage => game.route.find(r => r.stage === stage && !r.bonus);
  const bonus = game.route.find(r => r.bonus);
  const cols = MAP.stages.map((opts, i) => {
    const r = played(i);
    const pars = [...new Set(opts.map(h => holes[h].par))];
    const par = r ? holes[r.hole].par : pars.join('/');
    const current = !game.onBonus && i === game.stage && game.mode !== 'final';
    let cell = '&middot;', cls = '';
    if (r && r.score != null) {
      const d = r.score - holes[r.hole].par;
      cell = r.score;
      cls = d < 0 ? 'under' : d > 0 ? 'over' : '';
    }
    return { head: i + 1, par, cell, cls: `${cls} ${current ? 'current' : ''}` };
  });
  if (bonus) {
    // Shown faded when it doesn't count (par or worse on the bonus island).
    const d = bonus.score == null ? 0 : bonus.score - holes[bonus.hole].par;
    const off = bonus.score != null && !counts(bonus) ? 'void' : '';
    cols.push({ head: '\u2605', par: holes[bonus.hole].par, cell: bonus.score ?? '&middot;', cls: `${d < 0 ? 'under' : off} ${game.onBonus && game.mode !== 'final' ? 'current' : ''}` });
  }
  const t = totals();
  return `<table class="scorecard">
    <tr><th>Hole</th>${cols.map(c => `<th>${c.head}</th>`).join('')}<th>Tot</th></tr>
    <tr><th>Par</th>${cols.map(c => `<td>${c.par}</td>`).join('')}<td>${t.par || '&middot;'}</td></tr>
    <tr><th>You</th>${cols.map(c => `<td class="${c.cls}">${c.cell}</td>`).join('')}<td><b>${t.strokes || '&middot;'}</b></td></tr>
  </table>`;
}

// The golden ball: shown while you hold a mulligan, and pressable once a
// putt on this hole has come to rest.
export function updateMulligan() {
  const btn = $('mulligan');
  const show = game.mulligans > 0 && ['aim', 'rolling', 'splash'].includes(game.mode) && !$('hud').hidden;
  if (btn.hidden === show) btn.hidden = !show;
  const ready = show && game.mode === 'aim' && !!game.undo && !game.paused;
  if (btn.disabled === ready) btn.disabled = !ready;
}

export function fade(on) {
  $('fade').classList.toggle('on', on);
}


export function bestText(data) {
  if (!Number.isFinite(data.bestToPar)) return '';
  return `Best round: <b>${relName(data.bestToPar)}</b>${Number.isFinite(data.best) ? ` (${data.best} strokes)` : ''}`;
}

// While a card is up, the game controls behind it are out of reach.
function setInert(on) {
  for (const id of ['hud', 'cam-controls', 'game']) $(id).inert = on;
}

export function showCard(html, { clear = false } = {}) {
  $('card').innerHTML = html;
  const ov = $('overlay');
  ov.classList.add('show');
  ov.classList.toggle('clear', clear);
  setInert(true);
  const first = $('card').querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

export function hideCard() {
  $('overlay').classList.remove('show');
  setInert(false);
}

export function setPlaying(on) {
  $('hud').hidden = !on;
  $('cam-controls').hidden = !on;
}
