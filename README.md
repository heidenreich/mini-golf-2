# Mini Golf 2

3D mini golf on floating sky islands, played in your phone's browser. The sequel to [Mini Golf](https://github.com/heidenreich/mini-golf): the same drag-back-and-release putting, now with real slopes, ramps, a crater and a camera you can swing round the ball.

No build step. The only dependency is [three.js](https://threejs.org/) r160, vendored in `vendor/`.

**Play:** https://heidenreich.github.io/mini-golf-2/

## Course

**Sky Islands** (9 holes, par 26)

| # | Hole | Par | What's on it |
|---|------|-----|--------------|
| 1 | Welcome Hill | 2 | A gentle hump down the middle |
| 2 | Up the Ramp | 2 | A ramp up to a raised green. Too soft and the ball rolls back down |
| 3 | Dogleg Bowl | 3 | A right-hand dogleg with a bowl in the corner that gathers the ball, then downhill to the cup |
| 4 | Duck Pond | 3 | A pond in the middle of the fairway (+1 stroke, ball returns), a hump on the safe side and a bunker by the cup |
| 5 | The Sweeper | 3 | Up onto a plateau with a spinning bar, then down to the cup |
| 6 | Volcano | 3 | The cup sits in a crater on top of a hill. Too soft rolls back, too hard flies over the far rim |
| 7 | Switchback | 4 | Downhill round two corners, past a bunker, over a small ridge |
| 8 | Island Green | 3 | Two ponds with a narrow ice bridge between them, or the long way round |
| 9 | Grand Finale | 3 | Two sliding blocks, a ramp and a bowl round the cup |

Your best round is saved in your browser.

## Controls

- **Drag back** from anywhere on the screen and release to putt, like a slingshot. Full power is a thumb-length pull. A ring round the ball and a bar at the bottom show the power, and dotted guides show how the start of the roll will curve on slopes. A tiny drag cancels.
- **Look round:** two-finger drag on a phone (pinch to zoom), right-drag or the mouse wheel on a computer, Q/E on a keyboard, or the ⟲ ⟳ buttons.
- **⚑** turns the camera to face the flag. **▦** (or V) shows an overview of the whole hole.
- **Keyboard:** arrow keys aim (left/right) and set power (up/down), Shift for fine steps, Space or Enter putts. R restarts the hole, Esc opens the menu.
- Water costs a stroke and puts the ball back where you played from. The ball is picked up after 8 strokes.

## Run locally

ES modules need a web server (opening `index.html` straight from disk won't load them):

```sh
npx serve .
# or
python3 -m http.server
```

## Code

| File | What it does |
|------|--------------|
| `js/courses.js` | Every hole, as plain data |
| `js/terrain.js` | The ground: height and slope anywhere on a hole, built from ramps, hills, ridges and tilts |
| `js/physics.js` | Tuning constants and the ball simulation: slopes, friction, rails, spinners, sliding blocks, the cup |
| `js/render.js` | Everything you see, built with three.js: ground, rails, island, water, cup and flag, obstacles, scenery, aim guide, effects, camera |
| `js/main.js` | Game state, input, sound, screens, saving and the main loop |
| `css/style.css` | HUD, menus and cards |

How it works:

- **2.5D physics.** The ball rolls on a height field: the slope under it pushes it with 5/7 of gravity (a rolling ball), and it stops only once friction can hold it on that slope, so balls really do roll back down ramps. Rails, the spinner and the blocks are line segments in the ground plane.
- **What you see is what it rolls on.** The renderer builds the ground mesh from the same height function, and the rails follow it up and down.
- **Flat round the cup.** Whatever the hole's shape, the ground within 0.3 m of the cup is flat and blends back by 0.7 m, so a ball can stop next to the cup and drops in fairly.
- **Timestep:** fixed at 240 Hz, with sub-steps of under half a ball radius so a fast ball can't pass through a rail.
- **Cup:** a ball slower than `CUP_CAPTURE_SPEED` drops in; a faster one dips over the lip, curls and carries on.

Difficulty was tuned with a simulated player that picks a sensible line and then misses it by a gaussian amount: careful players (about ±3° and ±8% power) average around 22 for the round, casual players (±6°, ±15%) around 30.

`window.miniGolf2` exposes the game state plus `shoot(angle, power)`, `startRound` and `startHole(i)` for debugging and automated tests.
