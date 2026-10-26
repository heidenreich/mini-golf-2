// The course map: islands stage by stage, the bridges between them and your
// route so far.
import { game, holes, STAGES } from './state.js';
import { MAP } from './courses.js';
import { THEMES } from './themes.js';

const MAP_W = 340, ROW = 64, TOP = 34;
// Where each island sits on the map: stage by stage down the page, with
// the bonus island off to the side.
function mapSpot(hole) {
  if (hole === MAP.bonus.hole) return { x: MAP_W - 40, y: TOP + ROW * 3.5 };
  const stage = MAP.stages.findIndex(opts => opts.includes(hole));
  const opts = MAP.stages[stage];
  const x = opts.length === 1 ? 150 : opts.indexOf(hole) === 0 ? 88 : 212;
  return { x, y: TOP + ROW * stage };
}

function islandColors(hole) {
  const g = (THEMES[holes[hole].theme] || THEMES.meadow).ground;
  return { fill: `#${g.grassA.getHexString()}`, rim: `#${g.rough.getHexString()}` };
}

// choices: [{ hole, kind }] islands you can go to next (tappable).
export function mapSvg(choices = []) {
  const visited = new Map(game.route.map(r => [r.hole, r]));
  const choiceOf = new Map(choices.map(c => [c.hole, c]));
  const lines = [];
  const line = (a, b, cls) => {
    const p = mapSpot(a), q = mapSpot(b);
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2 + 8;
    lines.push(`<path class="${cls}" d="M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}"/>`);
  };
  const order = game.route.map(r => r.hole);
  const took = (a, b) => order.some((h, i) => h === a && order[i + 1] === b);
  for (let s = 0; s < STAGES - 1; s++) {
    for (const a of MAP.stages[s]) for (const b of MAP.stages[s + 1]) line(a, b, took(a, b) ? 'bridge taken' : 'bridge');
  }
  // A golden bridge can lead from any island, so only the one you opened or
  // took is drawn (all of them would bury the map).
  for (const s of MAP.bonus.from) {
    for (const a of MAP.stages[s]) {
      const open = choiceOf.get(MAP.bonus.hole) && game.holeIndex === a;
      if (took(a, MAP.bonus.hole) || open) line(a, MAP.bonus.hole, `bridge gold ${open ? 'open' : 'taken'}`);
    }
  }
  // And on from the bonus island to wherever you went next, so the route
  // stays joined up.
  const after = order[order.indexOf(MAP.bonus.hole) + 1];
  if (order.includes(MAP.bonus.hole) && after != null) line(MAP.bonus.hole, after, 'bridge gold taken');
  const nodes = holes.map((h, i) => {
    const { x, y } = mapSpot(i);
    const c = islandColors(i);
    const v = visited.get(i);
    const choice = choiceOf.get(i);
    const here = i === game.holeIndex && game.mode !== 'title';
    const score = v && v.score != null ? v.score : '';
    const d = v && v.score != null ? v.score - h.par : 0;
    const bonus = i === MAP.bonus.hole;
    const locked = bonus && !choice && !visited.has(i);
    // White score text doesn't show on a pale island (the cloud), so dark it is.
    const pale = (THEMES[h.theme] || THEMES.meadow).ground.grassA.getHSL({}).l > 0.75;
    const cls = ['island', choice ? 'choice' : '', v ? 'visited' : '', here ? 'here' : '', locked ? 'locked' : '', pale ? 'pale' : '', d < 0 ? 'under' : d > 0 ? 'over' : ''].join(' ');
    const attrs = choice ? ` data-go="${i}" role="button" tabindex="0" aria-label="Go to ${h.name}, par ${h.par}"` : '';
    return `<g class="${cls}" transform="translate(${x},${y})"${attrs}>
      <ellipse class="halo" rx="27" ry="21"/>
      <ellipse rx="21" ry="15" fill="${c.rim}"/>
      <ellipse rx="15" ry="10" cy="-1" fill="${c.fill}"/>
      ${score !== '' ? `<text class="score" y="4">${score}</text>` : locked ? '<text class="lock" y="5">\u{1F512}</text>' : ''}
      <text class="name" y="31">${h.name}</text>
      <text class="par" y="44">Par ${h.par}${bonus ? ' \u00b7 bonus' : ''}</text>
    </g>`;
  });
  const H = TOP + ROW * (STAGES - 1) + 52;
  return `<svg class="map" viewBox="0 0 ${MAP_W} ${H}" role="img" aria-label="Course map">${lines.join('')}${nodes.join('')}</svg>`;
}

