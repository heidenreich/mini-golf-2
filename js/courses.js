// Every hole is plain data. Units are roughly metres; x runs left to right
// and z runs away from the tee.
//
//   shape     outline of the fairway [x, z]; its edges become the boundary walls
//   tee, cup  [x, z]
//   look      where the camera first faces (defaults to the cup)
//   route     points round the corners of a dogleg, tee to cup; when the
//             ball stops, the camera turns to the furthest one it can see
//   ground    height features, added together (see terrain.js):
//               tilt   { gx, gz }                   a plane over the whole hole
//               ramp   { axis, from, to, rise }     a smooth step from one level to another
//               hill   { x, z, r | rx, rz, h }      a round bump (negative h makes a bowl)
//               ridge  { axis, at, w, h }           a bump running all the way across
//   zones     sand / water / ice: ellipses { x, z, w, d } centred on x, z,
//             or add rect: true for a rectangle
//   walls     extra wall segments [x1, z1, x2, z2]
//   spinners  rotating bars { x, z, len (half-length), speed (rad/s), phase }
//   movers    blocks { x1, z1, x2, z2, w, d, period, phase } gliding between two points
//   tip       shown when the hole starts

export const COURSE = {
  id: 'sky',
  name: 'Sky Islands',
  holes: [
    {
      name: 'Welcome Hill',
      par: 2,
      tip: 'Drag back from anywhere and let go to putt.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 13], [-1.5, 13]],
      tee: [0, 0],
      cup: [0.4, 11.4],
      ground: [
        { type: 'hill', x: -0.2, z: 6, rx: 2.2, rz: 2.4, h: 0.3 },
      ],
    },
    {
      name: 'Up the Ramp',
      par: 2,
      tip: 'Too soft and it rolls back down.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 13.5], [-1.5, 13.5]],
      tee: [0, 0],
      cup: [0.6, 11.6],
      ground: [
        { type: 'ramp', axis: 'z', from: 4.5, to: 7.5, rise: 0.9 },
      ],
    },
    {
      name: 'Dogleg Bowl',
      par: 3,
      tip: 'The bowl in the corner gathers the ball. Turn the camera to see round the bend.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 8], [12, 8], [12, 11.5], [0, 11.5], [-1.5, 10]],
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
      par: 3,
      tip: 'Water costs a stroke and puts you back where you were.',
      shape: [[-2.5, -1], [2.5, -1], [2.5, 14], [-2.5, 14]],
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
    },
    {
      name: 'The Sweeper',
      par: 3,
      tip: 'Time your putt past the spinning bar.',
      shape: [[-1.6, -1], [1.6, -1], [1.6, 13], [-1.6, 13]],
      tee: [0, 0],
      cup: [0, 11],
      ground: [
        { type: 'ramp', axis: 'z', from: 2, to: 4, rise: 0.4 },
        { type: 'ramp', axis: 'z', from: 8.5, to: 10, rise: -0.4 },
      ],
      spinners: [
        { x: 0, z: 6.2, len: 1.42, speed: 1.2, phase: 0 },
      ],
    },
    {
      name: 'Volcano',
      par: 3,
      tip: 'The cup sits in the crater. Hit it hard enough to climb the slope.',
      shape: [[-3, -1], [3, -1], [3, 12], [-3, 12]],
      tee: [0, 0],
      cup: [0, 7.4],
      ground: [
        { type: 'hill', x: 0, z: 7.4, r: 3.1, h: 0.8 },
        { type: 'hill', x: 0, z: 7.4, r: 1.6, h: -0.5 },
      ],
    },
    {
      name: 'Switchback',
      par: 4,
      tip: 'Downhill, round two corners, then a little rise to the cup.',
      shape: [[-1.5, -1], [1.5, -1], [1.5, 5], [8, 5], [8, 14], [5, 14], [5, 8.2], [-1.5, 8.2]],
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
      name: 'Island Green',
      par: 3,
      tip: 'Cross the icy bridge, or squeeze down the narrow path by a rail.',
      shape: [[-3, -1], [3, -1], [3, 14], [-3, 14]],
      tee: [0, 0],
      cup: [0.8, 12.2],
      ground: [
        { type: 'tilt', gx: 0.01 },
      ],
      zones: [
        { type: 'water', x: -1.55, z: 7.6, w: 1.9, d: 4.4 },
        { type: 'water', x: 1.55, z: 7.6, w: 1.9, d: 4.4 },
        { type: 'ice', x: 0, z: 7.6, w: 1.1, d: 4.4, rect: true },
      ],
    },
    {
      name: 'Grand Finale',
      par: 3,
      tip: 'Slip past the sliding blocks, then up into the bowl.',
      shape: [[-2, -1], [2, -1], [2, 18], [-2, 18]],
      tee: [0, 0],
      cup: [0, 16],
      ground: [
        { type: 'ramp', axis: 'z', from: 11, to: 13, rise: 0.55 },
        { type: 'hill', x: 0, z: 16, r: 1.7, h: -0.22 },
      ],
      movers: [
        { x1: -1.0, z1: 5, x2: 1.0, z2: 5, w: 1.3, d: 0.5, period: 3.2, phase: 0 },
        { x1: 1.0, z1: 8.8, x2: -1.0, z2: 8.8, w: 1.3, d: 0.5, period: 2.6, phase: 1.3 },
      ],
      zones: [
        { type: 'sand', x: -1.3, z: 12, w: 1.2, d: 1.4 },
      ],
    },
  ],
};
