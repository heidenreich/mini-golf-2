# Mini Golf 2

3D mini golf on floating sky islands, played in your phone's browser. The sequel to [Mini Golf](https://github.com/heidenreich/mini-golf): the same drag-back-and-release putting, now with real slopes, ramps, a crater and a camera you can swing round the ball.

No build step. The only dependency is [three.js](https://threejs.org/) r160, vendored in `vendor/`.

**Play:** https://heidenreich.github.io/mini-golf-2/

## Course

**Sky Islands** (9 holes, par 26)

Each hole sits on its own themed floating island: a wobbly outline with bays and headlands, an underside of earth and rock hanging into the sky, things dangling off the edge (vines, roots, icicles or lava), waterfalls on the greener islands, wisps of cloud round the base and small rocks drifting alongside. The fairways have rounded, cloud-soft outlines; rails stay straight where a hole is built around bank shots or moving blocks.

| # | Hole | Par | Island | What's on it |
|---|------|-----|--------|--------------|
| 1 | Welcome Hill | 2 | **Spring meadow**: flowers and butterflies | A gentle hump down the middle |
| 2 | The Gap | 2 | **Desert canyon**: red rock, cacti and mesas | Up a kicker and over a chasm. Too soft and the ball drops in (+1 stroke) |
| 3 | Dogleg Bowl | 3 | **Autumn forest**: orange and red trees, falling leaves | A left-hand dogleg with a bowl in the corner that gathers the ball, then downhill to the cup |
| 4 | Duck Pond | 3 | **Lily pond**: lily pads, reeds and ducks paddling round | A pond in the middle of the fairway (+1 stroke, ball returns), a hump on the safe side, a bunker by the cup and pinball bumpers behind it |
| 5 | Windmill | 3 | **Tulip fields**: stripes of tulips | Through the door between the turning sails, or the long way round either side |
| 6 | Volcano | 3 | **Volcanic island**: black rock, glowing lava cracks, rising embers | The cup sits in a crater on top of a hill. Too soft rolls back, too hard flies over the far rim |
| 7 | Switchback | 4 | **Tropical beach**: sand, palms and beach umbrellas | Downhill round two corners, past a bunker, over a small ridge |
| 8 | Frozen Island | 3 | **Winter**: snow, snowy pines, falling snowflakes | A snowy island where the whole fairway is frozen, so everything slides further. Two open-water ponds with an even slicker ice bridge between them, or a narrow path past them along either rail |
| 9 | Warp Finale | 3 | **Night**: stars, fireflies, glowing rails, fireworks when you hole out | Two sliding blocks, or a warp pipe on the right that shoots you up the ramp into the bowl round the cup |

Your best round is saved in your browser.

## Controls

- **Drag back from the ball** and release to putt, like a slingshot. A dashed ring round the ball shows where a drag starts a putt. Full power is a thumb-length pull. A ring round the ball and a bar at the bottom show the power, and dotted guides show how the start of the roll will curve on slopes, through one bounce off a rail. To cancel, bring your finger back to where it started (the bar says "Let go here to cancel") and let go.
- **Look round:** drag anywhere away from the ball with one finger (side to side turns, up and down tilts), pinch to zoom; on a computer, drag away from the ball or right-drag, and use the mouse wheel to zoom; Q/E on a keyboard; or the ⟲ ⟳ buttons. You can look round while the ball is rolling.
- **⚑** turns the camera to face the flag; it also turns on its own when the ball stops with the flag well out of view. **▦** (or V) shows an overview of the whole hole, with a yellow ring round the ball.
- **Keyboard:** arrow keys aim (left/right) and set power (up/down), Shift for fine steps, Space or Enter putts. R puts the ball back on the tee, Esc opens the menu.
- Water costs a stroke and puts the ball back where you played from. The ball is picked up after 8 strokes.
- **Back to the tee** (R, or in the menu) is a way out of a bad spot, not a do-over: the strokes you've taken still count.
- Held sideways on a phone, the score chips move to a column on the left so the far end of the hole stays in view.

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
| `js/physics.js` | Tuning constants and the ball simulation: slopes, friction, rails, sliding blocks, gaps, windmills, bumpers, warp pipes, the cup |
| `js/render.js` | Everything you see, built with three.js: ground, rails, island, water, cup and flag, obstacles, scenery, aim guide, effects, camera |
| `js/themes.js` | Each island's look: ground and sky colours, lights, trees and other scenery, particles in the air, and signature pieces (ducks, tulip fields, lava, stars) |
| `js/main.js` | Game state, input, sound, screens, saving and the main loop |
| `css/style.css` | HUD, menus and cards |

How it works:

- **2.5D physics.** The ball rolls on a height field: the slope under it pushes it with 5/7 of gravity (a rolling ball), and it stops only once friction can hold it on that slope, so balls really do roll back down ramps. Rails, the spinner and the blocks are line segments in the ground plane.
- **What you see is what it rolls on.** The renderer builds the ground mesh from the same height function, and the rails follow it up and down.
- **Flat round the cup.** Whatever the hole's shape, the ground within 0.32 m of the cup is flat and blends back by 0.7 m, so a ball can stop next to the cup and drops in fairly.
- **Stopped means slower than `REST_SPEED`.** A ball pushed against a rail by a slope keeps creeping at a few mm/s; that counts as stopped, so you can always putt it.
- **Rounded fairways.** Holes are drawn as simple outlines and `round` (in each hole's data) turns every corner into a curve before play, so the rails, physics and drawing all use the same smooth shape.
- **Reading slopes.** The ground is shaded by height and steepness, with contour lines every 10 cm of height on sloping ground, and the sun shines from behind the tee so slopes facing you light up.
- **Timestep:** fixed at 240 Hz, with sub-steps of under half a ball radius so a fast ball can't pass through a rail.
- **Cup:** a ball slower than `CUP_CAPTURE_SPEED` drops in; a faster one dips over the lip, curls and carries on.
- **Gaps:** reach the edge moving faster than `GAP_MIN_SPEED` (across the gap) and the ball flies over with nothing slowing it, drawn in an arc; slower and it drops in.
- **Windmills:** the building is ordinary walls with a tunnel through it. While a sail hangs within `WINDMILL_GATE` of straight down, a gate across the doorway bounces the ball back.
- **Bumpers** bounce like rails and then add `BUMPER_KICK` of speed. **Warp pipes** take any ball slower than `PIPE_MAX_SPEED` and fire it out of the far pipe at least `PIPE_MIN_OUT` fast.

Difficulty was tuned with a simulated player that picks a sensible line and then misses it by a gaussian amount: careful players (about ±3° and ±8% power) average around 22 for the round, casual players (±6°, ±15%) around 30.

`window.miniGolf2` exposes the game state plus `shoot(angle, power)`, `startRound` and `startHole(i)` for debugging and automated tests.
