# Mini Golf 2

3D mini golf on floating sky islands, played in your phone's browser. The sequel to [Mini Golf](https://github.com/heidenreich/mini-golf): the same drag-back-and-release putting, now with real slopes, ramps, a crater and a camera you can swing round the ball.

No build step. The only dependency is [three.js](https://threejs.org/) r160, vendored in `vendor/` along with the [Fredoka](https://github.com/hafontia/Fredoka-One) font (SIL Open Font License), so nothing loads from anywhere else.

**Play:** https://heidenreich.github.io/mini-golf-2/

**Install:** it's a PWA. On a phone, use *Add to Home Screen* (Safari's share menu, or Chrome's install prompt) and it opens full screen and plays offline. `sw.js` fetches the game's own files from the network first, so a new deploy shows up on the next load. three.js, the icons and the font are cached once and served from the cache after that. Bump `CACHE` in `sw.js` if you change anything in `vendor/` or the icons, and add a file to `SHELL` when you add a new script.

## Course

**Sky Islands**: 18 floating islands linked by rope bridges. A round crosses nine of them. Each bridge has a signpost naming the island it leads to. Where a stage has two islands you choose: the camera looks out over the bridges, you tap the label over the one you want, and it flies you across. With only one way on, it flies you straight there. The pause menu shows the whole course map and your route.

Each hole sits on its own themed floating island: a wobbly outline with bays and headlands, an underside of earth and rock hanging into the sky, things dangling off the edge (vines, roots, icicles, crystals or lava), waterfalls on the greener islands, wisps of cloud round the base and small rocks drifting alongside. The fairways have rounded, cloud-soft outlines; rails stay straight where a hole is built around bank shots or moving blocks.

| Stage | Island | Par | Theme | What's on it |
|---|---|---|---|---|
| 1 | Welcome Hill | 2 | Spring meadow | A gentle hump down the middle |
| 2 | The Gap | 2 | Desert canyon | Up a kicker and over a chasm. Too soft and the ball drops in (+1 stroke) |
| 2 | *or* Mushroom Grove | 3 | Mushroom grove | Giant mushrooms that bounce the ball about |
| 3 | Dogleg Bowl | 3 | Autumn forest | A left-hand dogleg with a bowl in the corner that gathers the ball |
| 3 | *or* Island Hopper | 3 | Tropical beach | Three islets with open sky between. Hop to the middle one, whose hollow catches the ball; too soft or too hard drops into the sky (+1 stroke) |
| 4 | Duck Pond | 3 | Lily pond | A pond in the middle (+1 stroke, ball returns), a bunker, bumpers behind the cup |
| 4 | *or* Cherry Terraces | 3 | Cherry blossom | Climb two terraces; too soft rolls back down a level |
| 5 | Windmill | 3 | Tulip fields | Through the door between the turning sails, or round either side |
| 5 | *or* Stepping Stones | 4 | Lily pond | Hop across zigzagging mossy stones with sky between, every hop on an angle |
| 6 | Volcano | 3 | Volcanic island | The cup sits in a crater on a hill |
| 6 | *or* Crystal Sweepers | 3 | Crystal caves | Two spinning crystal bars to time your putt past |
| 7 | Switchback | 4 | Tropical beach | Downhill round two corners, past a bunker, over a ridge |
| 7 | *or* Moon Hop | 3 | The Moon | Low gravity: the ball rolls on and on and barely feels the slopes, across craters to a cup up a crater's side |
| 8 | Frozen Island | 3 | Winter | The whole fairway is frozen; ponds either side of an ice bridge |
| 8 | *or* Rope Bridge | 3 | Cherry blossom | Putt along a sagging plank bridge with no rails; roll off the side and it falls (+1 stroke) |
| 9 | Warp Finale | 3 | Night | Sliding blocks, or a warp pipe up the ramp |
| 9 | *or* Drawbridge | 3 | Volcanic island | A rope bridge with a block sliding back and forth across it; time it or get knocked off |
| ★ | Cloud Island (bonus) | 2 | Cloud | Puffy cloud cushions bounce the ball back. Reached by a golden bridge |

**The golden bridge.** Make a birdie (or better) on Dogleg Bowl or on stage 6 and a golden bridge opens to Cloud Island, a bonus hole played before you carry on: a chance to win strokes back. You can visit it once a round.

Scores are measured against par for the route you took; your best round (to par) is saved in your browser.

## Controls

- **Drag back from the ball** and release to putt, like a slingshot. A dashed ring round the ball shows where a drag starts a putt. Full power is a thumb-length pull. A ring round the ball and a bar at the bottom show the power, and dotted guides show how the start of the roll will curve on slopes, through one bounce off a rail. To cancel, bring your finger back to where it started (the bar says "Let go here to cancel") and let go.
- **Look round:** drag anywhere away from the ball with one finger (side to side turns, up and down tilts), pinch to zoom; on a computer, drag away from the ball or right-drag, and use the mouse wheel to zoom; Q/E on a keyboard; or the Turn buttons (‹ ›). You can look round while the ball is rolling.
- **⚑** turns the camera to face the flag; it also turns on its own when the ball stops with the flag well out of view. **Overview** (or V) shows an overview of the whole hole, with a yellow ring round the ball.
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
| `js/courses.js` | Every hole as plain data, and the course map (stages, forks and the bonus island) |
| `js/terrain.js` | The ground: height and slope anywhere on a hole, built from ramps, hills, ridges and tilts |
| `js/physics.js` | Tuning constants and the ball simulation: slopes, friction, rails, sliding blocks, gaps, windmills, bumpers, warp pipes, the cup |
| `js/render.js` | Everything you see, built with three.js: ground, rails, island, water, cup and flag, obstacles, scenery, aim guide, effects, camera |
| `js/themes.js` | Each island's look: ground and sky colours, lights, trees and other scenery, particles in the air, and signature pieces (ducks, tulip fields, lava, stars) |
| `js/state.js` | What every part shares: the 3D world, the holes, the state of the round, totals and where you can go next |
| `js/main.js` | The flow of a round: title, holes, choosing a path, travel between islands, menus and the main loop |
| `js/play.js` | Putting and what the ball does: physics events, splashes and falls, sinking, picking up, where to draw the ball |
| `js/input.js` | Aiming and looking round: touch, mouse, keyboard, the camera buttons and the aim preview |
| `js/ui.js` | The HTML over the 3D view: HUD, banners, cards and the scorecard |
| `js/map.js` | The course map drawing |
| `js/audio.js` | Sound effects, made with Web Audio |
| `js/storage.js` | Saving the best round, settings and the round in progress |
| `sw.js` | The service worker that makes it installable and playable offline |
| `tools/simulate.mjs` | The simulated player used to tune each hole's difficulty (run with Node; not part of the game) |
| `css/style.css` | HUD, menus and cards |

How it works:

- **2.5D physics.** The ball rolls on a height field: the slope under it pushes it with 5/7 of gravity (a rolling ball), and it stops only once friction can hold it on that slope, so balls really do roll back down ramps. Rails, the spinner and the blocks are line segments in the ground plane.
- **What you see is what it rolls on.** The renderer builds the ground mesh from the same height function, and the rails follow it up and down.
- **Flat round the cup.** Whatever the hole's shape, the ground within 0.32 m of the cup is flat and blends back by 0.7 m, so a ball can stop next to the cup and drops in fairly.
- **Stopped means slower than `REST_SPEED`.** A ball pushed against a rail by a slope keeps creeping at a few mm/s; that counts as stopped, so you can always putt it.
- **Rounded fairways.** Holes are drawn as simple outlines and `round` (in each hole's data) turns every corner into a curve before play, so the rails, physics and drawing all use the same smooth shape.
- **Reading slopes.** The ground is shaded by height and steepness, with contour lines every 10 cm of height on sloping ground, and the sun shines from behind the tee so slopes facing you light up.
- **Timestep:** fixed at 240 Hz, with sub-steps of under half a ball radius so a fast ball can't pass through a rail.
- **Cup:** a ball slower than `CUP_CAPTURE_SPEED` drops in; a faster one dips over the lip, curls and carries on. Holing out on the last stage sets off fireworks.
- **Gaps:** reach the edge moving faster than `GAP_MIN_SPEED` (across the gap) and the ball flies over with nothing slowing it, drawn in an arc; slower and it drops in.
- **Low gravity:** a hole's `gravity` (0.35 on the Moon) scales the pull down slopes and the rolling resistance, so the ball rolls much further. The cup holds it less well too: the capture speed scales with the square root of gravity.
- **Narrow gaps** can set their own `minSpeed`, below `GAP_MIN_SPEED`. Stepping Stones uses this with a mossy surface (between grass and sand) so a hop can land and stop on a small stone.
- **Open edges:** a rope bridge, or a gap marked `split`, cuts the island right through and has no rails. A ball that leaves the fairway there falls (+1 stroke), where anywhere else it would just be put back.
- **Windmills:** the building is ordinary walls with a tunnel through it. While a sail hangs within `WINDMILL_GATE` of straight down, a gate across the doorway bounces the ball back.
- **Bumpers** bounce like rails and then add `BUMPER_KICK` of speed. **Warp pipes** take any ball slower than `PIPE_MAX_SPEED` and fire it out of the far pipe at least `PIPE_MIN_OUT` fast.

Difficulty was tuned with a simulated player that picks a sensible line and then misses it by a gaussian amount: careful players (about ±3° and ±8% power) average around 22 for the round, casual players (±6°, ±15%) around 30. The player is in `tools/simulate.mjs`: `node tools/simulate.mjs "Rope Bridge" 100` plays a hole 100 times at each skill level and prints the average and spread of scores. It takes a second or two a stroke, so run holes in parallel when tuning several. (The round averages above came from an earlier version of this player, which played a little worse.) The two newest holes are the hardest alternates: on Island Hopper careful players average about 3.1 and casual ones 3.6; Rope Bridge is about 2.1 for careful players but 4.0 for casual ones, who often roll off the side.

`window.miniGolf2` exposes the game state plus `shoot(angle, power)`, `startRound` and `startHole(i)` for debugging and automated tests.
