import { roundShape } from './terrain.js';

// Every hole is plain data. Units are roughly metres; z runs away from the
// tee and x runs across (+x is on your left as you face down the hole).
//
//   shape     outline of the fairway [x, z]; its edges become the boundary walls
//   round     how far (m) each corner of the outline is rounded off
//   tee, cup  [x, z]
//   look      where the camera first faces (defaults to the cup)
//   route     points round the corners of a dogleg, tee to cup; when the
//             ball stops, the camera turns to the furthest one it can see
//   ground    height features, added together (see terrain.js):
//               tilt   { gx, gz }                   a plane over the whole hole
//               ramp   { axis, from, to, rise }     a smooth step from one level to another
//               hill   { x, z, r | rx, rz, h }      a round bump (negative h makes a bowl)
//               ridge  { axis, at, w, h }           a bump running all the way across
//   zones     sand / water / ice / moss / snow: ellipses { x, z, w, d } centred on x, z,
//             or add rect: true for a rectangle
//   walls     extra wall segments [x1, z1, x2, z2]
//   spinners  rotating bars { x, z, len (half-length), speed (rad/s), phase }
//   movers    blocks { x1, z1, x2, z2, w, d, period, phase } gliding between two points
//   gaps      chasms right across the hole { z1, z2 }: reach the edge fast
//             enough and the ball flies over, too slow and it drops in (+1 stroke).
//             split: true opens the island right through, with sky below;
//             minSpeed overrides how fast the ball must be going to clear it
//   ropeBridges  { z1, z2 }: between z1 and z2 the fairway is a plank bridge
//             with no rails; roll off the side and it falls (+1 stroke)
//   windmills { x, z, w, d, door, period, phase }: a building with a tunnel
//             through it; the sails block the doorway as they pass
//   bumpers   pinball bumpers { x, z, r } that kick the ball away
//   railKick  rails that bounce the ball back harder (m/s added on a hit)
//   pipes     warp pipes { from: [x, z], to: [x, z], dir }: roll in at
//             `from`, pop out at `to` heading along dir (radians, 0 = +z)
//   tip       shown when the hole starts
//   surface   the fairway's surface where no zone says otherwise (default grass)
//   gravity   a fraction of normal gravity (the Moon): weaker slopes, and the
//             ball rolls further
//   theme     the island's look (see themes.js): meadow, desert, autumn, pond,
//             tulips, volcano, beach, winter or night

// A puffy cloud: an oval with bulges all round.
function cloud(cx, cz, rx, rz) {
  return Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    const r = 1 + 0.12 * Math.cos(a * 6);
    return [cx + Math.cos(a) * rx * r, cz + Math.sin(a) * rz * r];
  });
}

// An oval outline with n corners (rounded off afterwards like any other).
function ellipse(cx, cz, rx, rz, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz];
  });
}

export const COURSE = {
  id: 'sky',
  name: 'Sky Islands',
  holes: [
    {
      name: 'Welcome Hill',
      theme: 'meadow',
      par: 2,
      tip: 'Drag back from the ball and let go to putt. Drag anywhere else to look round.',
      shape: [[-1.5, -1], [1.5, -1], [1.7, 3], [2.3, 6], [1.7, 9], [1.6, 13], [-1.6, 13], [-1.7, 9], [-2.3, 6], [-1.7, 3]],
      round: 1.0,
      tee: [0, 0],
      cup: [0.4, 11.4],
      ground: [
        { type: 'hill', x: -0.2, z: 6, rx: 2.2, rz: 2.4, h: 0.3 },
      ],
    },
    {
      name: 'The Gap',
      theme: 'desert',
      par: 2,
      tip: 'Up the kicker and over the gap. Too soft and it drops in.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 8], [2.0, 10.5], [1.6, 13], [-1.6, 13], [-2.0, 10.5], [-1.5, 8]],
      round: 0.8,
      tee: [0, 0],
      cup: [0.4, 10.8],
      ground: [
        { type: 'ramp', axis: 'z', from: 2.5, to: 4.6, rise: 0.35 },
      ],
      gaps: [
        { z1: 5.6, z2: 7.0 },
      ],
    },
    {
      name: 'Dogleg Bowl',
      theme: 'autumn',
      par: 3,
      tip: 'The bowl in the corner gathers the ball. Drag the view round to see past the bend.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 8], [12, 8], [12, 11.5], [0, 11.5], [-1.5, 10]],
      round: 0.5,
      tee: [0, 0],
      cup: [10.6, 9.75],
      look: [0, 9],
      route: [[0, 9.6], [10.6, 9.75]],
      ground: [
        { type: 'hill', x: 0, z: 9.6, r: 2.0, h: -0.35 },
        { type: 'ramp', axis: 'x', from: 3, to: 9, rise: -0.45 },
      ],
    },
    {
      name: 'Duck Pond',
      theme: 'pond',
      par: 3,
      tip: 'Water costs a stroke and puts you back. Bumpers behind the cup kick an overhit back.',
      shape: [[-2.5, -1], [2.5, -1], [2.9, 4], [2.6, 9], [2.8, 14], [-2.6, 14], [-2.9, 9], [-2.6, 4]],
      round: 1.2,
      tee: [0, 0],
      cup: [-1, 11.8],
      ground: [
        { type: 'hill', x: 1.7, z: 6.6, r: 1.3, h: 0.22 },
        { type: 'tilt', gx: -0.012 },
      ],
      zones: [
        { type: 'water', x: -0.75, z: 6.5, w: 3.4, d: 2.6 },
        { type: 'sand', x: 1.4, z: 10.4, w: 1.6, d: 1.6 },
      ],
      bumpers: [
        { x: -0.1, z: 13.1, r: 0.2 },
        { x: -1.9, z: 12.9, r: 0.2 },
      ],
    },
    {
      name: 'Windmill',
      theme: 'tulips',
      par: 3,
      tip: 'Time it through the door between the sails, or go round the side.',
      shape: [[-1.6, -1], [1.6, -1], [2.0, 2.5], [1.6, 5], [1.6, 8], [2.1, 10.5], [1.6, 13], [-1.6, 13], [-2.1, 10.5], [-1.6, 8], [-1.6, 5], [-2.0, 2.5]],
      round: 0.9,
      tee: [0, 0],
      cup: [0, 10.6],
      ground: [
        { type: 'hill', x: 1.25, z: 6.5, rx: 0.45, rz: 1.0, h: 0.1 },
        { type: 'hill', x: -1.25, z: 6.5, rx: 0.45, rz: 1.0, h: 0.1 },
        { type: 'ramp', axis: 'z', from: 7.2, to: 9.4, rise: -0.25 },
      ],
      windmills: [
        { x: 0, z: 6.5, w: 1.3, d: 1.0, door: 0.62, period: 5, phase: 0 },
      ],
    },
    {
      name: 'Volcano',
      theme: 'volcano',
      par: 3,
      tip: 'The cup sits in the crater. Hit it hard enough to climb the slope.',
      shape: ellipse(0, 5.4, 3.3, 6.6, 12),
      round: 1.0,
      tee: [0, 0],
      cup: [0, 7.4],
      ground: [
        { type: 'hill', x: 0, z: 7.4, r: 3.1, h: 0.8 },
        { type: 'hill', x: 0, z: 7.4, r: 1.6, h: -0.5 },
      ],
    },
    {
      name: 'Switchback',
      theme: 'beach',
      par: 4,
      tip: 'Downhill, round two corners, then a little rise to the cup.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 5], [8, 5], [8, 14], [5, 14], [5, 8.2], [-1.5, 8.2]],
      round: 0.5,
      tee: [0, 0],
      cup: [6.5, 12.4],
      look: [0, 6.5],
      route: [[0, 6.6], [6.5, 6.6], [6.5, 12.4]],
      ground: [
        { type: 'ramp', axis: 'z', from: 1, to: 4, rise: -0.5 },
        { type: 'ramp', axis: 'x', from: 2, to: 4.5, rise: -0.4 },
        { type: 'ridge', axis: 'z', at: 10.3, w: 1.6, h: 0.18 },
      ],
      zones: [
        { type: 'sand', x: 6.6, z: 6.6, w: 1.6, d: 1.2 },
      ],
    },
    {
      name: 'Frozen Island',
      par: 3,
      tip: 'The whole island is frozen, so everything slides further. Cross the ice bridge, or squeeze down a rail.',
      theme: 'winter',
      surface: 'frost',
      shape: [[-3, -1], [3, -1], [3.3, 4], [3.3, 11], [3, 14], [-3, 14], [-3.3, 11], [-3.3, 4]],
      round: 1.5,
      tee: [0, 0],
      cup: [0.8, 12.2],
      ground: [
        { type: 'tilt', gx: 0.01 },
      ],
      zones: [
        { type: 'water', x: -1.5, z: 7.6, w: 1.6, d: 3.8 },
        { type: 'water', x: 1.5, z: 7.6, w: 1.6, d: 3.8 },
        { type: 'ice', x: 0, z: 7.6, w: 1.4, d: 3.8, rect: true },
        // A snowbank behind the cup: on the ice even a gentle rebound off the
        // back rail would otherwise slide all the way back in.
        { type: 'snow', x: 0.6, z: 13.55, w: 4, d: 0.8, rect: true },
      ],
    },
    {
      name: 'Warp Finale',
      theme: 'night',
      par: 3,
      tip: 'Slip past the sliding blocks, or find the warp pipe on the right.',
      shape: [[-2, -1], [2, -1], [2, 10.8], [2.6, 14], [1.8, 18], [-1.8, 18], [-2.6, 14], [-2, 10.8]],
      round: 1.0,
      tee: [0, 0],
      cup: [0, 16],
      ground: [
        { type: 'ramp', axis: 'z', from: 11, to: 13, rise: 0.55 },
        { type: 'hill', x: 0, z: 16, r: 1.7, h: -0.22 },
      ],
      movers: [
        { x1: -1.0, z1: 5, x2: 1.0, z2: 5, w: 1.1, d: 0.5, period: 3.2, phase: 0 },
        { x1: 1.0, z1: 8.8, x2: -1.0, z2: 8.8, w: 1.1, d: 0.5, period: 2.6, phase: 1.3 },
      ],
      pipes: [
        { from: [-1.45, 3.2], to: [1.45, 10.2], dir: 0 },
      ],
      zones: [
        { type: 'sand', x: -1.3, z: 12, w: 1.2, d: 1.4 },
      ],
    },
    {
      name: 'Mushroom Grove',
      theme: 'mushroom',
      par: 3,
      tip: 'Giant mushrooms bounce the ball about. Find a way through the grove.',
      shape: [[-1.6, -1], [1.6, -1], [2.2, 4], [1.4, 8], [2.0, 12], [1.4, 14], [-1.6, 14], [-2.0, 10], [-1.2, 6], [-2.2, 3]],
      round: 1.0,
      tee: [0, 0],
      // Far enough from the back rail that a ball rebounding off it runs out
      // of pace before the cup.
      cup: [0.2, 11.8],
      ground: [
        { type: 'hill', x: 0.2, z: 11.8, r: 1.3, h: -0.12 },
      ],
      bumpers: [
        { x: 0.7, z: 4.4, r: 0.28 },
        { x: -0.55, z: 5.4, r: 0.28 },
        { x: -0.1, z: 7.5, r: 0.2 },
        { x: 0.8, z: 9.3, r: 0.26 },
        { x: -0.8, z: 9.7, r: 0.26 },
      ],
    },
    {
      name: 'Cherry Terraces',
      theme: 'blossom',
      par: 3,
      tip: 'Climb two terraces to the top. Too soft and the ball rolls back down a level.',
      shape: [[-1.6, -1], [1.6, -1], [2.0, 4], [1.6, 7], [2.1, 10.5], [1.6, 14], [-1.6, 14], [-2.1, 10.5], [-1.6, 7], [-2.0, 4]],
      round: 1.0,
      tee: [0, 0],
      cup: [-0.5, 12.3],
      ground: [
        { type: 'ramp', axis: 'z', from: 3.0, to: 4.6, rise: 0.35 },
        { type: 'ramp', axis: 'z', from: 7.8, to: 9.4, rise: 0.35 },
      ],
      zones: [
        { type: 'sand', x: 1.0, z: 11.4, w: 1.0, d: 1.2 },
      ],
    },
    {
      name: 'Crystal Sweepers',
      theme: 'crystal',
      par: 3,
      tip: 'Two crystal bars sweep the fairway. Time your putt past each one.',
      shape: [[-1.6, -1], [1.6, -1], [1.8, 6.5], [1.6, 13], [-1.6, 13], [-1.8, 6.5]],
      round: 1.0,
      tee: [0, 0],
      cup: [0, 11.4],
      spinners: [
        { x: 0, z: 4.6, len: 1.25, speed: 1.0, phase: 0 },
        { x: 0, z: 8.4, len: 1.25, speed: -1.3, phase: 0.8 },
      ],
    },
    {
      name: 'Cloud Island',
      theme: 'cloud',
      bonus: true,
      par: 2,
      tip: 'Bonus island! Par or better wins a mulligan, and a hole-in-one comes off your score. Bank it round the puff.',
      shape: cloud(0, 5, 2.8, 5.2),
      round: 0.5,
      tee: [0, 0.6],
      cup: [0.3, 9.3],
      railKick: 1.0,
      bumpers: [
        { x: 0, z: 5.2, r: 0.45 },
      ],
    },
    // Added after the bonus island so earlier holes keep their numbers
    // (a saved round remembers holes by number).
    {
      name: 'Island Hopper',
      theme: 'beach',
      par: 3,
      tip: 'Hop over to the middle island: the sand at its far end stops the ball. Too soft or too hard and it drops into the sky.',
      shape: [[-1.6, -1], [1.6, -1], [1.8, 2], [1.6, 4.2], [1.6, 5.6], [2.0, 6.6], [2.0, 7.8], [1.6, 8.8], [1.6, 10.2], [1.9, 12], [1.6, 14], [-1.6, 14], [-1.9, 12], [-1.6, 10.2], [-1.6, 8.8], [-2.0, 7.8], [-2.0, 6.6], [-1.6, 5.6], [-1.6, 4.2], [-1.8, 2]],
      round: 0.5,
      tee: [0, 0],
      cup: [0.3, 12.4],
      // The middle island's hollow and sand catch a wide range of putts (only
      // near full power carries on into the second gap), and the lips either
      // side of that gap stop a slow ball dribbling in.
      ground: [
        { type: 'hill', x: 0, z: 7.0, r: 1.3, h: -0.2 },
        { type: 'ridge', axis: 'z', at: 8.8, w: 1.2, h: 0.15 },
        { type: 'ridge', axis: 'z', at: 10.2, w: 1.0, h: 0.12 },
      ],
      zones: [
        { type: 'sand', x: 0, z: 8.15, w: 4.2, d: 1.2, rect: true },
      ],
      gaps: [
        { z1: 4.2, z2: 5.6, split: true },
        { z1: 8.8, z2: 10.2, split: true },
      ],
    },
    {
      name: 'Rope Bridge',
      theme: 'blossom',
      par: 3,
      tip: 'No rails on the bridge, and it sags in the middle. Keep it straight or over the side it goes.',
      shape: [[-1.7, -1], [1.7, -1], [1.9, 1.5], [1.5, 3], [0.7, 3.2], [0.7, 9.0], [1.5, 9.2], [1.9, 11.5], [1.6, 13.8], [-1.6, 13.8], [-1.9, 11.5], [-1.5, 9.2], [-0.7, 9.0], [-0.7, 3.2], [-1.5, 3], [-1.9, 1.5]],
      round: 0.4,
      tee: [0, 0],
      cup: [-0.3, 12.0],
      // The bridge sags along its length, and a little across it too, so a
      // ball slightly off line drifts back towards the middle.
      ground: [
        { type: 'hill', x: 0, z: 6.1, rx: 2.5, rz: 2.9, h: -0.22 },
      ],
      ropeBridges: [
        { z1: 3.6, z2: 8.6 },
      ],
      // Stops a full-power putt off the back rail rolling back into the cup.
      zones: [
        { type: 'sand', x: -0.3, z: 13.0, w: 2.6, d: 1.0 },
      ],
    },
    {
      name: 'Stepping Stones',
      theme: 'pond',
      par: 4,
      tip: 'Hop from stone to stone. They zigzag, so every hop is on an angle.',
      // Four little islands, each offset from the last, with short hops of
      // open sky between. Moss and a shallow hollow settle the ball on each
      // stone.
      shape: [
        [-1.7, -1], [0.6, -1], [0.6, 2.9],
        [2.1, 3.8], [2.1, 6.2],
        [0.3, 7.1], [0.3, 9.5],
        [1.8, 10.4], [1.9, 12.2], [1.6, 14], [-0.7, 14], [-0.9, 12.2], [-0.6, 10.4],
        [-2.1, 9.5], [-2.1, 7.1],
        [-0.3, 6.2], [-0.3, 3.8],
        [-1.7, 2.9],
      ],
      round: 0.35,
      tee: [-0.6, 0],
      cup: [0.5, 12.6],
      ground: [
        { type: 'hill', x: 0.9, z: 5.0, r: 1.0, h: -0.12 },
        { type: 'hill', x: -0.9, z: 8.3, r: 1.0, h: -0.12 },
      ],
      zones: [
        { type: 'moss', x: 0.9, z: 5.0, w: 2.6, d: 2.4, rect: true },
        { type: 'moss', x: -0.9, z: 8.3, w: 2.6, d: 2.4, rect: true },
      ],
      gaps: [
        { z1: 2.9, z2: 3.8, split: true, minSpeed: 1.5 },
        { z1: 6.2, z2: 7.1, split: true, minSpeed: 1.5 },
        { z1: 9.5, z2: 10.4, split: true, minSpeed: 1.5 },
      ],
    },
    {
      name: 'Moon Hop',
      theme: 'moon',
      gravity: 0.35,
      par: 3,
      tip: 'Low gravity: the ball rolls and rolls, and barely feels the slopes. The cup is up the side of a crater.',
      shape: ellipse(0, 6.5, 3.2, 7.6, 14),
      round: 1.2,
      tee: [0, 0],
      // Up the inside of the last crater, so a ball rolling in settles at
      // the bottom rather than funnelling into the cup.
      cup: [0.75, 12.0],
      // Craters: a raised rim with a hollow inside.
      ground: [
        { type: 'hill', x: -1.1, z: 5.0, r: 1.5, h: 0.14 },
        { type: 'hill', x: -1.1, z: 5.0, r: 0.9, h: -0.3 },
        { type: 'hill', x: 1.3, z: 7.6, r: 1.1, h: 0.1 },
        { type: 'hill', x: 1.3, z: 7.6, r: 0.65, h: -0.22 },
        { type: 'hill', x: -0.3, z: 11.4, r: 2.0, h: 0.22 },
        { type: 'hill', x: -0.3, z: 11.4, r: 1.3, h: -0.32 },
      ],
    },
    {
      name: 'Drawbridge',
      theme: 'volcano',
      par: 3,
      tip: 'A block slides back and forth across the bridge. Time it, or it knocks you over the side.',
      shape: [[-1.7, -1], [1.7, -1], [1.9, 1.5], [1.5, 3], [0.8, 3.2], [0.8, 9.6], [1.5, 9.8], [1.9, 12], [1.6, 14.2], [-1.6, 14.2], [-1.9, 12], [-1.5, 9.8], [-0.8, 9.6], [-0.8, 3.2], [-1.5, 3], [-1.9, 1.5]],
      round: 0.4,
      tee: [0, 0],
      cup: [0.3, 12.4],
      ground: [
        { type: 'hill', x: 0, z: 6.4, rx: 2.5, rz: 3.2, h: -0.18 },
      ],
      ropeBridges: [
        { z1: 3.6, z2: 9.2 },
      ],
      movers: [
        { x1: -0.5, z1: 6.4, x2: 0.5, z2: 6.4, w: 0.4, d: 0.3, period: 3.6, phase: 0 },
      ],
    },
  ],
};

for (const hole of COURSE.holes) {
  if (hole.round) hole.shape = roundShape(hole.shape, hole.round);
}

// The islands are linked by rope bridges. A round crosses nine stages;
// where a stage has two islands you pick one. A hole-in-one on a `from`
// stage (any but the last) opens a golden bridge to the bonus island,
// played as an extra hole before carrying on, once a round.
export const MAP = {
  stages: [
    ['Welcome Hill'],
    ['The Gap', 'Mushroom Grove'],
    ['Dogleg Bowl', 'Island Hopper'],
    ['Duck Pond', 'Cherry Terraces'],
    ['Windmill', 'Stepping Stones'],
    ['Volcano', 'Crystal Sweepers'],
    ['Switchback', 'Moon Hop'],
    ['Frozen Island', 'Rope Bridge'],
    ['Warp Finale', 'Drawbridge'],
  ].map(stage => stage.map(name => COURSE.holes.findIndex(h => h.name === name))),
  bonus: { hole: COURSE.holes.findIndex(h => h.name === 'Cloud Island'), from: [0, 1, 2, 3, 4, 5, 6, 7] },
};
