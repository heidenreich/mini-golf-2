import * as THREE from '../vendor/three.module.min.js';
import { insidePolygon, zoneContains, smooth } from './terrain.js';
import { BALL_R, CUP_R, PIPE_R, WALL_HALF, spinnerAngle, moverState, windmillAngle, openBands, clipToBands } from './physics.js';
import { THEMES, CRYSTAL_COLORS, rng, lambert, makeTree, makeDrift, skyTexture } from './themes.js';

// Draws a hole and everything on it. Nothing in here affects the game:
// physics and rules live in physics.js and main.js.

const GRID = 0.1;            // ground mesh resolution (m)
const ISLAND_MIN = 1.2;      // the island reaches this far past the rails at least...
const ISLAND_VARY = 1.2;     // ...and up to this much further, varying round the edge
const ROUGH_DROP = 0.05;     // rough sits a touch below the fairway
const RAIL_TOP = 0.13;
const RAIL_BOTTOM = -0.22;

const COLORS = {
  rough: new THREE.Color('#5aa63c'),
  sand: new THREE.Color('#ead59a'),
  ice: new THREE.Color('#d7f2fb'),
  moss: new THREE.Color('#4f8f3e'),
  snow: new THREE.Color('#fbfdff'),
  pondBed: new THREE.Color('#3d8a8f'),
  rail: new THREE.Color('#fbf3e4'),
  railSide: new THREE.Color('#e6d6b8'),
  post: new THREE.Color('#d9573b'),
  dirt: new THREE.Color('#7d5536'),
};

function nearestOnSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const l2 = dx * dx + dz * dz;
  const u = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l2)) : 0;
  return [x1 + dx * u, z1 + dz * u];
}

function nearestOnPolygon(pts, x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const q = nearestOnSegment(x, z, x1, z1, x2, z2);
    const d = (q[0] - x) ** 2 + (q[1] - z) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return { point: best, dist: Math.sqrt(bd) };
}

function bounds(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

// Smooth random bumps (value noise, two octaves), 0..1.
function noise2(seed) {
  const hash = (i, j) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const one = (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, z) => one(x, z) * 0.7 + one(x * 2.3 + 17, z * 2.3 + 5) * 0.3;
}

// The island under a hole: everything within a wobbly distance of the
// fairway, so its edge has bays and headlands instead of straight sides.
// `open`: bands of z ({ z1, z2 }) where the island is cut right through,
// with sky below (rope bridges and split gaps).
function makeIsland(shape, b, seed, open = []) {
  const bump = noise2(seed);
  const reach = (x, z) => ISLAND_MIN + ISLAND_VARY * bump(x * 0.33, z * 0.33);
  const pad = ISLAND_MIN + ISLAND_VARY + 0.2;
  let grid = null;   // distance to the fairway on the ground grid, once known
  // Distance from (x, z) to the fairway, read off the grid when there is one.
  const fairwayDist = (x, z) => {
    if (!grid) return nearestOnPolygon(shape, x, z).dist;
    const fx = (x - grid.x0) / GRID, fz = (z - grid.z0) / GRID;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= grid.nx - 1 || j >= grid.nz - 1) return nearestOnPolygon(shape, x, z).dist;
    const u = fx - i, v = fz - j, d = grid.d, n = grid.nx, k = j * n + i;
    return d[k] * (1 - u) * (1 - v) + d[k + 1] * u * (1 - v) + d[k + n] * (1 - u) * v + d[k + n + 1] * u * v;
  };
  const island = {
    x0: b.x0 - pad, x1: b.x1 + pad, z0: b.z0 - pad, z1: b.z1 + pad,
    inside(x, z, inset = 0) {
      const pad = Math.max(0, inset);
      if (open.some(o => z > o.z1 - pad && z < o.z2 + pad)) return false;
      if (insidePolygon(shape, x, z)) return true;
      return fairwayDist(x, z) + inset <= reach(x, z);
    },
    // Measure every grid node's distance to the fairway in two sweeps
    // (a chamfer distance: close enough for the island's wobbly edge).
    useGrid(x0, z0, nx, nz, inPoly) {
      const d = new Float32Array(nx * nz);
      for (let k = 0; k < d.length; k++) d[k] = inPoly[k] ? 0 : 1e9;
      const D1 = GRID, D2 = GRID * Math.SQRT2;
      const relax = (k, k2, s) => { if (d[k2] + s < d[k]) d[k] = d[k2] + s; };
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (i > 0) relax(k, k - 1, D1);
          if (j > 0) { relax(k, k - nx, D1); if (i > 0) relax(k, k - nx - 1, D2); if (i < nx - 1) relax(k, k - nx + 1, D2); }
        }
      }
      for (let j = nz - 1; j >= 0; j--) {
        for (let i = nx - 1; i >= 0; i--) {
          const k = j * nx + i;
          if (i < nx - 1) relax(k, k + 1, D1);
          if (j < nz - 1) { relax(k, k + nx, D1); if (i < nx - 1) relax(k, k + nx + 1, D2); if (i > 0) relax(k, k + nx - 1, D2); }
        }
      }
      grid = { x0, z0, nx, nz, d };
    },
    // The point on the island's edge on the way from the fairway out to (x, z).
    snap(x, z) {
      if (island.inside(x, z)) return [x, z];
      const [qx, qz] = nearestOnPolygon(shape, x, z).point;
      const dx = x - qx, dz = z - qz, len = Math.hypot(dx, dz);
      let lo = 0, hi = len;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (island.inside(qx + (dx * mid) / len, qz + (dz * mid) / len)) lo = mid;
        else hi = mid;
      }
      return [qx + (dx * lo) / len, qz + (dz * lo) / len];
    },
  };
  return island;
}

// Pale blue ice with long streaks and a few cracks. `aspect` is width / length.
function iceTexture(aspect) {
  const W = 128, H = Math.round(128 / Math.max(0.1, aspect));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Math.min(1024, H);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, c.height);
  grad.addColorStop(0, '#d8f3ff');
  grad.addColorStop(0.5, '#bfe7fb');
  grad.addColorStop(1, '#e6f8ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, c.height);
  const rand = rng(12);
  g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  for (let i = 0; i < 26; i++) {
    g.lineWidth = 1 + rand() * 3;
    const x = rand() * W, y = rand() * c.height, len = 30 + rand() * 90;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len * 0.35, y + len);
    g.stroke();
  }
  g.strokeStyle = 'rgba(120, 175, 205, 0.55)';
  g.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let x = rand() * W, y = rand() * c.height;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rand() - 0.5) * 30;
      y += (rand() - 0.3) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 64);
  // A coloured band and a dot, so you can see the ball roll.
  g.fillStyle = '#ff5a5f';
  g.fillRect(0, 29, 128, 6);
  g.beginPath();
  g.arc(32, 14, 6, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  constructor(canvas) {
    const lowPower = Math.min(screen.width, screen.height) < 500;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Phones' 3x screens cost far more than they show on a small, moving picture.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#d9f0ff', 35, 95);
    this.skies = {};

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.cam = {
      yaw: 0, pitch: 0.58, dist: 5,
      target: new THREE.Vector3(),
      want: { yaw: 0, pitch: 0.58, dist: 5, target: new THREE.Vector3() },
      overview: false,
    };

    this.hemi = new THREE.HemisphereLight('#e4f3ff', '#5f8a3e', 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff6e0', 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ballTex = ballTexture();
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 16),
      new THREE.MeshStandardMaterial({ map: this.ballTex, roughness: 0.35 }),
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    this.buildAim();
    this.buildSky();
    this.particles = [];
    this.holeGroup = null;
    this.time = 0;
  }

  // ---- Sky: clouds and far-off islands ------------------------------------

  buildSky() {
    const rand = rng(7);
    this.sky = new THREE.Group();
    const cloudMat = this.cloudMat = lambert('#ffffff', { flatShading: true, emissive: '#dfeaf5', emissiveIntensity: 0.35 });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(rand() * 4);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const s = 1 + rand() * 1.6;
        m.scale.set(s * 1.3, s * 0.8, s);
        m.position.set((j - n / 2) * 1.5 + rand(), rand() * 0.6, rand() * 1.2);
        cloud.add(m);
      }
      const a = rand() * Math.PI * 2, r = 32 + rand() * 30;
      cloud.position.set(Math.cos(a) * r, -10 + rand() * 18, Math.sin(a) * r);
      cloud.scale.setScalar(0.8 + rand() * 1.2);
      this.sky.add(cloud);
    }
    for (let i = 0; i < 5; i++) {
      const isle = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2, 1.7, 0.5, 9), lambert(COLORS.rough, { flatShading: true }));
      const under = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.5, 9), lambert(COLORS.dirt, { flatShading: true }));
      under.rotation.x = Math.PI;
      under.position.y = -2;
      isle.add(top, under);
      for (let t = 0; t < 2; t++) {
        const tree = makeTree(rand, 0.9);
        tree.position.set((rand() - 0.5) * 2, 0.25, (rand() - 0.5) * 2);
        isle.add(tree);
      }
      const a = (i / 5) * Math.PI * 2 + rand(), r = 40 + rand() * 25;
      isle.position.set(Math.cos(a) * r, -14 + rand() * 8, Math.sin(a) * r);
      isle.scale.setScalar(1 + rand() * 1.5);
      isle.userData.bob = rand() * Math.PI * 2;
      isle.userData.baseY = isle.position.y;
      this.sky.add(isle);
    }
    this.scene.add(this.sky);
  }

  // ---- A hole ---------------------------------------------------------------

  // links: { outs: ['next' | 'gold' | 'locked', ...] } the rope bridges
  // leading on from this island (one comes in behind the tee as well).
  buildHole(hole, terrain, index, links = { outs: [] }) {
    if (this.holeGroup) {
      this.scene.remove(this.holeGroup);
      // Free everything the old island used, textures included; phones
      // run out of graphics memory a few islands in otherwise.
      this.holeGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        // One material, or a list of them (the signposts have one per face).
        for (const m of [].concat(o.material || [])) {
          if (!m.dispose) continue;
          for (const key of ['map', 'alphaMap', 'emissiveMap']) if (m[key]) m[key].dispose();
          m.dispose();
        }
      });
    }
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.particles = [];

    this.hole = hole;
    this.terrain = terrain;
    const theme = this.theme = THEMES[hole.theme] || THEMES.meadow;
    this.pal = theme.ground;
    this.applySky(theme);
    const g = this.holeGroup = new THREE.Group();
    const b = this.bounds = bounds(hole.shape);
    this.open = openBands(hole);
    const island = this.island = makeIsland(hole.shape, b, 11 + index * 7, this.open);

    this.buildGround(g, hole, terrain, island);
    this.buildUnderside(g, terrain, island);
    this.buildIslandDressing(g, hole, terrain, island, index);
    this.buildBridges(g, hole, terrain, links);
    this.buildRails(g, hole, terrain);
    this.buildWater(g, hole, terrain);
    this.buildIce(g, hole, terrain);
    this.buildCup(g, hole, terrain);
    this.buildObstacles(g, hole, terrain);
    this.buildGaps(g, hole, terrain);
    this.buildRopeBridges(g, hole, terrain);
    this.buildWindmills(g, hole, terrain);
    this.buildBumpers(g, hole, terrain);
    this.buildPipes(g, hole, terrain);
    this.buildScenery(g, hole, terrain, island, index);
    this.drift = null;
    if (theme.drift) {
      this.drift = makeDrift(island, theme.drift);
      g.add(this.drift.points);
    }
    this.themeUpdate = theme.extras ? theme.extras(this.themeApi(g)) : null;
    if (theme.night) this.glowAtNight(g);

    // Fit the sun's shadow to this island.
    const size = Math.max(island.x1 - island.x0, island.z1 - island.z0) / 2 + 1;
    const cam = this.sun.shadow.camera;
    cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
    cam.near = 1; cam.far = 60;
    cam.updateProjectionMatrix();
    this.sun.position.set(b.cx + 7, 11, b.z0 - 9);
    this.sun.target.position.set(b.cx, 0, b.cz);
    this.sky.position.set(b.cx, 0, b.cz);

    this.scene.add(g);
  }

  // Sky, fog and lights for a theme (the sky gradient is made once per theme).
  applySky(theme) {
    const sky = theme.sky;
    this.scene.background = this.skies[theme.name] || (this.skies[theme.name] = skyTexture(sky));
    this.scene.fog.color.set(sky.fog);
    this.hemi.color.set(sky.hemi[0]);
    this.hemi.groundColor.set(sky.hemi[1]);
    this.hemi.intensity = sky.hemi[2];
    this.sun.color.set(sky.sun[0]);
    this.sun.intensity = sky.sun[1];
    const night = !!theme.night;
    this.cloudMat.color.set(night ? '#5a6690' : '#ffffff');
    this.cloudMat.emissiveIntensity = night ? 0.05 : 0.35;
    this.ball.material.emissive.set(night ? '#ffffff' : '#000000');
    this.ball.material.emissiveIntensity = night ? 0.35 : 0;
  }

  // What a theme's extras get to work with.
  themeApi(group) {
    return {
      group, hole: this.hole, terrain: this.terrain, island: this.island, bounds: this.bounds,
      waters: this.waters,
      nearRail: (x, z) => nearestOnPolygon(this.hole.shape, x, z).dist,
    };
  }

  // At night the rails, posts, pipes, bumpers and blocks glow.
  glowAtNight(g) {
    g.traverse(o => {
      const m = o.material;
      if (!m || !('emissive' in m) || o.userData.noGlow) return;
      if (o.userData.glow) {
        m.emissive.set(o.userData.glow);
        m.emissiveIntensity = 0.6;
      }
    });
  }

  buildGround(g, hole, terrain, island) {
    const x0 = island.x0, z0 = island.z0;
    const nx = Math.ceil((island.x1 - x0) / GRID) + 1;
    const nz = Math.ceil((island.z1 - z0) / GRID) + 1;
    const [cx, cz] = hole.cup;
    const zones = hole.zones || [];

    // Two meshes from the same grid: the fairway snaps its outside vertices
    // onto the rail line (and the lip of the cup); the rough snaps its
    // inside vertices onto the same line and its outer ones to the island's
    // edge. They meet exactly under the rails.
    const fairPos = new Float32Array(nx * nz * 3), fairCol = new Float32Array(nx * nz * 3);
    const roughPos = new Float32Array(nx * nz * 3), roughCol = new Float32Array(nx * nz * 3);
    const inPoly = new Uint8Array(nx * nz);
    const rand = rng(99);
    const col = new THREE.Color();
    const pal = this.pal;
    const zoneColor = { sand: COLORS.sand, ice: COLORS.ice, water: COLORS.pondBed, moss: COLORS.moss, snow: COLORS.snow };
    // Holes cut in the fairway: the cup and warp pipe mouths, and gaps.
    const cuts = [[cx, cz, CUP_R], ...(hole.pipes || []).map(p => [p.from[0], p.from[1], PIPE_R])];
    // Gaps, and rope bridges (drawn as planks instead of grass).
    const gaps = [...(hole.gaps || []), ...(hole.ropeBridges || [])];
    const inCut = (x, z) => cuts.some(([ux, uz, r]) => Math.hypot(x - ux, z - uz) < r) || gaps.some(gp => z > gp.z1 && z < gp.z2);
    // Where the island is cut right through, and the nearer edge of that cut.
    const openAt = z => this.open.find(o => z > o.z1 && z < o.z2);
    const openEdge = (o, z) => (z - o.z1 < o.z2 - z ? o.z1 : o.z2);

    const inIsl = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        inPoly[j * nx + i] = insidePolygon(hole.shape, x0 + i * GRID, z0 + j * GRID) ? 1 : 0;
      }
    }
    island.useGrid(x0, z0, nx, nz, inPoly);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const z = z0 + j * GRID;
        inIsl[k] = !openAt(z) && (inPoly[k] || island.inside(x0 + i * GRID, z)) ? 1 : 0;
      }
    }
    // Next to the island's edge (and so worth snapping onto it).
    const nearShore = (i, j) => {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz && inIsl[b * nx + a]) return true;
        }
      }
      return false;
    };
    this.grid = { x0, z0, nx, nz, inPoly, inIsl, roughPos };
    // Only vertices next to the outline need snapping onto it.
    const nearEdge = (i, j) => {
      const v = inPoly[j * nx + i];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz && inPoly[b * nx + a] !== v) return true;
        }
      }
      return false;
    };

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = x0 + i * GRID, z = z0 + j * GRID;
        const inside = inPoly[k] === 1;
        const edge = nearEdge(i, j);

        // Fairway vertex (only those inside or touching the outline are used).
        if (inside || edge) {
          let fx = x, fz = z;
          if (!inside) [fx, fz] = nearestOnPolygon(hole.shape, x, z).point;
          for (const [ux, uz, r] of cuts) {
            const d = Math.hypot(fx - ux, fz - uz);
            if (d < r) {
              fx = d > 1e-6 ? ux + ((fx - ux) * r) / d : ux + r;
              fz = d > 1e-6 ? uz + ((fz - uz) * r) / d : uz;
            }
          }
          for (const gp of gaps) {
            if (fz > gp.z1 && fz < gp.z2) fz = fz - gp.z1 < gp.z2 - fz ? gp.z1 : gp.z2;
          }
          const dc = Math.hypot(fx - cx, fz - cz);
          const h = terrain.renderHeight(fx, fz);
          fairPos[k * 3] = fx;
          fairPos[k * 3 + 1] = h;
          fairPos[k * 3 + 2] = fz;

          // Mown stripes, then sand, ice and pond bed painted on top.
          col.copy(Math.floor((fz + 100) / 0.8) % 2 ? pal.grassA : pal.grassB);
          for (const zone of zones) {
            const t = zoneEdge(zone, fx, fz);
            if (t > 0) col.lerp(zoneColor[zone.type], t);
          }
          if (dc < 0.75) col.lerp(pal.green, 0.35 * (1 - dc / 0.75));
          // Make the ground's shape readable: higher ground lighter, steeper
          // ground darker, and contour lines every 10 cm of height.
          const [gx, gz] = terrain.grad(fx, fz);
          const slope = Math.hypot(gx, gz);
          let shade = 1 + Math.max(-0.25, Math.min(0.25, h * 0.22)) - Math.min(0.3, slope * 0.55);
          if (slope > 0.03) {
            const f = (((h + 10) / 0.1) % 1 + 1) % 1;
            if (f < 0.35) shade -= 0.12 * Math.min(1, slope / 0.08);
          }
          col.multiplyScalar(shade);
          fairCol[k * 3] = col.r;
          fairCol[k * 3 + 1] = col.g;
          fairCol[k * 3 + 2] = col.b;
        }

        // Where the island is cut through, the edge of the cut is a straight
        // line across: these points (rough, and the underside's rim) sit on it.
        const open = openAt(z);
        if (open) {
          const ez = openEdge(open, z);
          // Pulled in to the island's edge, so nothing sticks out sideways.
          const zIn = ez + (ez === open.z1 ? -0.01 : 0.01);
          const rx = island.inside(x, zIn) ? x : island.snap(x, zIn)[0];
          roughPos[k * 3] = rx;
          roughPos[k * 3 + 1] = terrain.height(rx, ez) - ROUGH_DROP;
          roughPos[k * 3 + 2] = ez;
          col.copy(pal.rough).lerp(pal.roughDark, rand() * 0.6);
          roughCol.set([col.r, col.g, col.b], k * 3);
        } else if ((!inside || edge) && (inIsl[k] || nearShore(i, j))) {
          // Rough vertex
          let rx = x, rz = z;
          if (inside) [rx, rz] = nearestOnPolygon(hole.shape, x, z).point;
          else if (!inIsl[k]) [rx, rz] = island.snap(x, z);
          roughPos[k * 3] = rx;
          roughPos[k * 3 + 1] = terrain.height(rx, rz) - ROUGH_DROP + (inside ? 0 : (rand() - 0.5) * 0.025);
          roughPos[k * 3 + 2] = rz;
          col.copy(pal.rough).lerp(pal.roughDark, rand() * 0.6);
          roughCol[k * 3] = col.r;
          roughCol[k * 3 + 1] = col.g;
          roughCol[k * 3 + 2] = col.b;
        }
      }
    }

    const fairIdx = [], roughIdx = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        const mx = x0 + (i + 0.5) * GRID, mz = z0 + (j + 0.5) * GRID;
        // Cells wholly inside or outside the outline skip the polygon test.
        const sum = inPoly[a] + inPoly[b] + inPoly[c] + inPoly[d];
        const isl = inIsl[a] + inIsl[b] + inIsl[c] + inIsl[d];
        const tris = [[a, c, b, mx - GRID / 6, mz - GRID / 6], [b, c, d, mx + GRID / 6, mz + GRID / 6]];
        for (const [p, q, r, tx, tz] of tris) {
          const inside = sum === 4 ? true : sum === 0 ? false : insidePolygon(hole.shape, tx, tz);
          if (inside) {
            if (!inCut(tx, tz)) fairIdx.push(p, q, r);
          } else if (isl === 4 || (isl > 0 && island.inside(tx, tz))) {
            roughIdx.push(p, q, r);
          }
        }
      }
    }

    const mesh = (pos, colr, idx, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      return m;
    };
    // A frozen fairway is glossy; grass and snow are matt.
    const fairMat = this.pal.glossy
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: '#a9d4ea', emissiveIntensity: 0.22 })
      : lambert('#ffffff', { vertexColors: true });
    g.add(mesh(fairPos, fairCol, fairIdx, fairMat));
    g.add(mesh(roughPos, roughCol, roughIdx, lambert('#ffffff', { vertexColors: true })));
  }

  // The island's underside: an upside-down mountain of earth and rock,
  // deepest under the middle, with craggy points hanging off it.
  buildUnderside(g, terrain, island) {
    const { x0, z0, nx, nz, inIsl, roughPos } = this.grid;
    const N = nx * nz;
    // Distance from each island node to the edge (two-pass chamfer).
    const dist = new Float32Array(N).fill(1e9);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!inIsl[k]) { dist[k] = 0; continue; }
        if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) dist[k] = 0;
      }
    }
    const D1 = GRID, D2 = GRID * Math.SQRT2;
    const relax = (k, k2, d) => { if (dist[k2] + d < dist[k]) dist[k] = dist[k2] + d; };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i > 0) relax(k, k - 1, D1);
        if (j > 0) { relax(k, k - nx, D1); if (i > 0) relax(k, k - nx - 1, D2); if (i < nx - 1) relax(k, k - nx + 1, D2); }
      }
    }
    let maxD = 0;
    for (let j = nz - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        if (i < nx - 1) relax(k, k + 1, D1);
        if (j < nz - 1) { relax(k, k + nx, D1); if (i < nx - 1) relax(k, k + nx + 1, D2); if (i > 0) relax(k, k + nx - 1, D2); }
        maxD = Math.max(maxD, dist[k]);
      }
    }
    this.grid.dist = dist;

    const bump = noise2(41);
    const pal = this.pal;
    const deep = 3 + maxD * 0.45;
    const pos = new Float32Array(N * 3), colr = new Float32Array(N * 3);
    const col = new THREE.Color();
    this.undersideBottom = Infinity;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        let x = x0 + i * GRID, z = z0 + j * GRID;
        if (!inIsl[k]) { x = roughPos[k * 3]; z = roughPos[k * 3 + 2]; }
        const d = dist[k];
        const top = terrain.height(x, z) - ROUGH_DROP;
        const t = Math.min(1, d / maxD);
        // A thin lip at the edge, then down to a deep point in the middle.
        const depth = (1 - Math.exp(-d / 0.6)) * 0.45 + deep * Math.pow(t, 0.85) + (bump(x * 0.9, z * 0.9) - 0.5) * 0.7 * Math.min(1, d / 1.5);
        const y = top - depth;
        pos.set([x, y, z], k * 3);
        this.undersideBottom = Math.min(this.undersideBottom, y);
        // Earth near the top, then bands of rock further down.
        if (depth < 0.18) col.copy(pal.roughDark);
        else if (depth < 0.8) col.copy(pal.dirtTop).lerp(pal.dirt, (depth - 0.18) / 0.62);
        else col.copy(pal.dirt).lerp(pal.rock, Math.min(1, (depth - 0.8) / 2.5));
        col.multiplyScalar(0.92 + 0.12 * Math.sin(y * 5 + bump(x, z) * 3));
        colr.set([col.r, col.g, col.b], k * 3);
      }
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        const isl = inIsl[a] + inIsl[b] + inIsl[c] + inIsl[d];
        if (isl === 0) continue;
        const mx = x0 + (i + 0.5) * GRID, mz = z0 + (j + 0.5) * GRID;
        if (isl < 4 && !island.inside(mx, mz)) continue;
        idx.push(a, b, c, b, d, c);   // facing down
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const cloudy = this.theme.cloudy;
    g.add(new THREE.Mesh(geo, lambert('#ffffff', cloudy ? { vertexColors: true, emissive: '#e8eef7', emissiveIntensity: 0.35 } : { vertexColors: true })));

    // Rocky points hanging from the deeper parts (or, under a cloud, puffs).
    const rand = rng(17);
    const rockMat = lambert(pal.rock, { flatShading: true });
    if (cloudy) {
      const puffMat = lambert('#ffffff', { flatShading: true, emissive: '#eef4fb', emissiveIntensity: 0.4 });
      for (let n = 0; n < 40; n++) {
        const k = Math.floor(rand() * N);
        if (!inIsl[k]) continue;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 + rand() * 0.6, 1), puffMat);
        m.position.set(pos[k * 3], pos[k * 3 + 1] + 0.2, pos[k * 3 + 2]);
        m.scale.y = 0.7;
        g.add(m);
      }
      return;
    }
    let tries = 0, made = 0;
    while (made < 14 && tries++ < 400) {
      const k = Math.floor(rand() * N);
      if (!inIsl[k] || dist[k] < 0.7) continue;
      const len = 0.5 + rand() * 1.4 * Math.min(1, dist[k] / 2);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12 + rand() * 0.25, len, 6), rockMat);
      cone.rotation.x = Math.PI;
      cone.position.set(pos[k * 3], pos[k * 3 + 1] - len / 2 + 0.1, pos[k * 3 + 2]);
      g.add(cone);
      made++;
    }
  }

  // Points round the island's edge, each with the direction facing out.
  shorePoints(spacing) {
    const { x0, z0, nx, nz, inIsl, roughPos } = this.grid;
    const pts = [];
    const taken = new Map();
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (inIsl[k]) continue;
        if (!(inIsl[k - 1] || inIsl[k + 1] || inIsl[k - nx] || inIsl[k + nx])) continue;
        const x = roughPos[k * 3], z = roughPos[k * 3 + 2];
        const key = `${Math.round(x / spacing)},${Math.round(z / spacing)}`;
        if (taken.has(key)) continue;
        taken.set(key, true);
        const y = this.terrain.height(x, z) - ROUGH_DROP;
        // Along a cut through the island, the edge faces straight across it.
        const open = this.open.find(o => Math.abs(z - o.z1) < 1e-6 || Math.abs(z - o.z2) < 1e-6);
        if (open) {
          pts.push({ x, z, nx: 0, nz: Math.abs(z - open.z1) < 1e-6 ? 1 : -1, y });
          continue;
        }
        const [qx, qz] = nearestOnPolygon(this.hole.shape, x, z).point;
        const l = Math.hypot(x - qx, z - qz) || 1;
        pts.push({ x, z, nx: (x - qx) / l, nz: (z - qz) / l, y });
      }
    }
    return pts;
  }

  // What makes it look like it floats: things hanging off the edge,
  // waterfalls, wisps of cloud round the base and little rocks drifting
  // alongside.
  buildIslandDressing(g, hole, terrain, island, index) {
    const theme = this.theme;
    const rand = rng(300 + index * 13);
    this.floaters = [];
    const shore = this.shorePoints(0.45);
    const night = !!theme.night;

    // Along the edge: vines, roots, icicles or drips of lava.
    const edge = theme.edge;
    const vine = lambert('#3f8f3a', { flatShading: true });
    const root = lambert('#6b4a2c', { flatShading: true });
    const ice = lambert('#e6f6ff', { emissive: '#bfe6ff', emissiveIntensity: 0.3 });
    const lava = new THREE.MeshBasicMaterial({ color: '#ff6a1a' });
    for (const p of shore) {
      if (!edge || rand() < 0.45) continue;
      const x = p.x - p.nx * 0.06, z = p.z - p.nz * 0.06;
      if (edge === 'crystals') {
        const color = CRYSTAL_COLORS[Math.floor(rand() * CRYSTAL_COLORS.length)];
        const len = 0.2 + rand() * 0.45;
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color }));
        c.scale.y = len / 0.12;
        c.position.set(x, p.y - 0.05 - len / 2, z);
        g.add(c);
      } else if (edge === 'icicles' || edge === 'lava') {
        const len = 0.15 + rand() * (edge === 'lava' ? 0.35 : 0.55);
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.03 + rand() * 0.04, len, 5), edge === 'lava' ? lava : ice);
        c.rotation.x = Math.PI;
        c.position.set(x, p.y - 0.05 - len / 2, z);
        g.add(c);
      } else {
        const len = 0.3 + rand() * 0.9;
        const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, len, 4), edge === 'vines' ? vine : root);
        strand.position.set(x, p.y - len / 2, z);
        strand.rotation.z = (rand() - 0.5) * 0.3;
        g.add(strand);
        if (edge === 'vines') {
          for (let k = 0; k < 3; k++) {
            const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), vine);
            leaf.position.set(x + (rand() - 0.5) * 0.06, p.y - len * (0.2 + k * 0.3), z + (rand() - 0.5) * 0.06);
            g.add(leaf);
          }
        }
      }
    }

    // Waterfalls pouring off each side, with a little stream feeding them.
    this.falls = [];
    if (theme.waterfall && shore.length) {
      const cx = (island.x0 + island.x1) / 2;
      const zs = shore.map(p => p.z), zmin = Math.min(...zs), zmax = Math.max(...zs);
      for (const side of [-1, 1]) {
        const cands = shore.filter(p => (p.x - cx) * side > 0 && p.z > zmin + (zmax - zmin) * 0.3 && p.z < zmax - (zmax - zmin) * 0.25 && Math.abs(p.nx) > 0.7);
        if (!cands.length) continue;
        const p = cands[Math.floor(rand() * cands.length)];
        this.addWaterfall(g, p);
      }
    }

    // Wisps of cloud round the island's base.
    const wispMat = lambert(night ? '#4a5580' : '#ffffff', { flatShading: true, transparent: true, opacity: 0.88, emissive: night ? '#000000' : '#e8f1fa', emissiveIntensity: 0.35 });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 9 && shore.length; i++) {
      const p = shore[Math.floor(rand() * shore.length)];
      const wisp = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(puff, wispMat);
        const sc = 0.35 + rand() * 0.35;
        m.scale.set(sc * 1.6, sc * 0.55, sc);
        m.position.set((k - 1) * 0.45, rand() * 0.15, rand() * 0.3);
        wisp.add(m);
      }
      const out = 0.3 + rand() * 0.8;
      wisp.position.set(p.x + p.nx * out, p.y - 1 - rand() * 1.8, p.z + p.nz * out);
      wisp.rotation.y = Math.atan2(p.nx, p.nz) + Math.PI / 2;
      g.add(wisp);
      this.floaters.push({ obj: wisp, baseY: wisp.position.y, amp: 0.08, rate: 0.4 + rand() * 0.3, phase: rand() * 6 });
    }

    // A few small rocks drifting alongside, some with a plant on top.
    const cx = (island.x0 + island.x1) / 2, cz = (island.z0 + island.z1) / 2;
    const half = Math.max(island.x1 - island.x0, island.z1 - island.z0) / 2;
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2, r = half * (0.7 + rand() * 0.3) + 1.5 + rand() * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (island.inside(x, z, -0.8)) continue;
      const isle = new THREE.Group();
      const size = 0.35 + rand() * 0.4;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(size, size * 0.9, 0.12, 8), lambert(this.pal.rough, { flatShading: true }));
      const under = new THREE.Mesh(new THREE.ConeGeometry(size * 0.9, size * 2.6, 8), lambert(this.pal.dirt, { flatShading: true }));
      under.rotation.x = Math.PI;
      under.position.y = -0.06 - size * 1.3;
      isle.add(top, under);
      if (rand() < 0.6) {
        const plant = theme.scenery(this, rand, false);
        if (plant) {
          plant.scale.multiplyScalar(0.6);
          plant.position.y = 0.06;
          isle.add(plant);
        }
      }
      isle.position.set(x, terrain.height(cx, cz) - 0.6 + (rand() - 0.5) * 2, z);
      g.add(isle);
      this.floaters.push({ obj: isle, baseY: isle.position.y, amp: 0.15, rate: 0.5 + rand() * 0.3, phase: rand() * 6 });
    }
  }

  // Rope bridges: one comes in behind the tee, and one heads off beyond the
  // cup towards each island you can go to next. A golden one leads to the
  // bonus island (with a padlock until a hole-in-one opens it).
  buildBridges(g, hole, terrain, links) {
    this.bridgeIn = null;
    this.bridgesOut = [];
    const shore = this.shorePoints(0.3);
    if (!shore.length) return;
    const [tx, tz] = hole.tee, [cx, cz] = hole.cup;
    const fl = Math.hypot(cx - tx, cz - tz) || 1;
    const fx = (cx - tx) / fl, fz = (cz - tz) / fl;
    // The shore point furthest out from (ox, oz) in direction (dx, dz).
    const anchor = (ox, oz, dx, dz) => {
      let best = null, score = -Infinity;
      for (const p of shore) {
        const sc = (p.x - ox) * dx + (p.z - oz) * dz + (p.nx * dx + p.nz * dz) * 0.5;
        if (sc > score) { score = sc; best = p; }
      }
      return best;
    };
    const rot = (a) => [fx * Math.cos(a) + fz * Math.sin(a), -fx * Math.sin(a) + fz * Math.cos(a)];

    const pin = anchor(tx, tz, -fx, -fz);
    this.bridgeIn = this.makeBridge(g, pin, -fx, -fz, 'next');

    const outs = (links.outs || []).map(o => (typeof o === 'string' ? { kind: o } : o));
    const nexts = outs.filter(o => o.kind === 'next').length;
    let n = 0;
    for (const { kind, name, par } of outs) {
      let a = 0;
      if (kind === 'next') a = nexts > 1 ? (n++ === 0 ? 0.8 : -0.8) : 0;
      else a = 1.3;
      const [dx, dz] = rot(a);
      const p = anchor(cx, cz, dx, dz);
      const b = this.makeBridge(g, p, dx, dz, kind);
      if (name) {
        const sp = this.makeSignpost(g, p, dx, dz, kind, name, par);
        b.sign = sp.pos;
        b.paintSign = sp.paint;
      }
      this.bridgesOut.push(b);
    }
  }

  // A wooden signpost beside a bridge's entrance, naming where it leads.
  // Returns the point above it where a label can float.
  makeSignpost(g, p, dx, dz, kind, name, par) {
    const gold = kind !== 'next';
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 112;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const paint = k => {
      const gilt = k !== 'next';
      ctx.fillStyle = gilt ? '#e8b84a' : '#c99a62';
      ctx.fillRect(0, 0, 256, 112);
      ctx.strokeStyle = gilt ? '#a8761a' : '#7a5530';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 248, 104);
      ctx.fillStyle = '#3a2412';
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px Fredoka, system-ui, sans-serif';
      ctx.fillText(name, 128, 50, 236);
      ctx.font = '600 24px Fredoka, system-ui, sans-serif';
      ctx.fillText(k === 'locked' ? 'Bonus \u00b7 hole-in-one' : gilt ? `Bonus \u00b7 par ${par}` : `Par ${par}`, 128, 86, 236);
      tex.needsUpdate = true;
    };
    paint(kind);
    // Beside the bridge on the right as you walk onto it, facing the island.
    const sx = dz * 0.62, sz = -dx * 0.62;
    const x = p.x - sx - dx * 0.25, z = p.z - sz - dz * 0.25;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.0, 6), lambert('#6b4a2c'));
    post.position.set(x, p.y + 0.5, z);
    post.castShadow = true;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.28, 0.03), [
      lambert('#7a5530'), lambert('#7a5530'), lambert('#7a5530'), lambert('#7a5530'),
      lambert('#ffffff', { map: tex }), lambert('#7a5530'),
    ]);
    board.position.set(x, p.y + 0.86, z);
    board.rotation.y = Math.atan2(-dx, -dz);   // the painted face looks back at the island
    board.castShadow = true;
    g.add(post, board);
    return { pos: new THREE.Vector3(x, p.y + 1.15, z), paint };
  }

  // A sagging plank bridge from shore point p heading off (dx, dz) into the
  // clouds. Returns the path along its deck, for the camera to follow.
  makeBridge(g, p, dx, dz, kind) {
    const L = 11, W = 0.62;
    const gold = kind === 'gold' || kind === 'locked';
    const y0 = p.y + 0.02;
    const at = t => new THREE.Vector3(p.x + dx * L * t - dx * 0.15, y0 - 0.7 * 4 * t * (1 - t) - 0.6 * t, p.z + dz * L * t - dz * 0.15);
    const yaw = Math.atan2(dx, dz);
    const plankMat = gold
      ? new THREE.MeshStandardMaterial({ color: kind === 'locked' ? '#a08a52' : '#e8b84a', emissive: '#ffcf4a', emissiveIntensity: kind === 'locked' ? 0.05 : 0.35, roughness: 0.5 })
      : lambert('#9b7048', { flatShading: true });
    const ropeMat = gold ? lambert('#ffd23f', { emissive: '#ffb703', emissiveIntensity: kind === 'locked' ? 0.1 : 0.5 }) : lambert('#d9c8a0');
    const planks = Math.round(L / 0.2);
    const plankGeo = new THREE.BoxGeometry(W, 0.035, 0.14);
    for (let i = 0; i <= planks; i++) {
      const t = i / planks;
      const a = at(t), b = at(Math.min(1, t + 0.01));
      const m = new THREE.Mesh(plankGeo, plankMat);
      m.position.copy(a);
      m.rotation.set(0, yaw, 0);
      m.rotateX(-Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) + (Math.random() - 0.5) * 0.06);
      m.castShadow = true;
      g.add(m);
    }
    // Rope handrails, sagging a little more than the deck, with hangers.
    const sx = dz * (W / 2 + 0.03), sz = -dx * (W / 2 + 0.03);
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, a = at(t);
        pts.push(new THREE.Vector3(a.x + sx * side, a.y + 0.48 - 0.15 * 4 * t * (1 - t), a.z + sz * side));
      }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.018, 5), ropeMat));
      for (let i = 1; i < 20; i += 2) {
        const top = pts[i], t = i / 20, a = at(t);
        const h = top.y - a.y;
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, h, 4), ropeMat);
        hanger.position.set(top.x, a.y + h / 2, top.z);
        g.add(hanger);
      }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.62, 6), lambert(gold ? '#c9952a' : '#6b4a2c'));
      post.position.set(p.x + sx * side - dx * 0.1, y0 + 0.2, p.z + sz * side - dz * 0.1);
      post.castShadow = true;
      g.add(post);
    }
    // The far end disappears into a bank of cloud.
    const end = at(1);
    const puffMat = lambert('#ffffff', { flatShading: true, emissive: '#eef4fb', emissiveIntensity: 0.4, transparent: true, opacity: 0.92 });
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + k * 0.15, 1), puffMat);
      m.position.set(end.x + dz * (k - 1.5) * 0.5, end.y - 0.2 + (k % 2) * 0.3, end.z - dx * (k - 1.5) * 0.5);
      m.scale.y = 0.6;
      g.add(m);
    }
    if (kind === 'locked') {
      // A padlock hangs across the entrance.
      const lock = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.08), new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.6, roughness: 0.3 }));
      const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14, Math.PI), lambert('#c9c9c9'));
      shackle.position.y = 0.08;
      lock.add(body, shackle);
      lock.position.set(p.x + dx * 0.3, y0 + 0.42, p.z + dz * 0.3);
      lock.rotation.y = yaw;
      g.add(lock);
      this.lastLock = lock;
      this.floaters.push({ obj: lock, baseY: lock.position.y, amp: 0.03, rate: 2, phase: 0 });
    }
    const path = [];
    for (let i = 0; i <= 24; i++) path.push(at(i / 24).add(new THREE.Vector3(0, 0.55, 0)));
    return { path, kind, dx, dz, plankMat, ropeMat, lock: this.lastLock };
  }

  // A hole-in-one opens the golden bridge: it lights up and the padlock pops off.
  unlockGold() {
    for (const b of this.bridgesOut || []) {
      if (b.kind !== 'locked') continue;
      b.kind = 'gold';
      if (b.paintSign) b.paintSign('gold');
      b.plankMat.color.set('#e8b84a');
      b.plankMat.emissiveIntensity = 0.35;
      b.ropeMat.emissiveIntensity = 0.5;
      if (b.lock) {
        const { x, y, z } = b.lock.position;
        b.lock.parent.remove(b.lock);
        this.floaters = this.floaters.filter(f => f.obj !== b.lock);
        this.burst(x, y, z, { count: 40, colors: ['#ffd23f', '#ffffff', '#ffb703'], speed: 1.6, up: 2, life: 1.2, size: 0.05, gravity: 3 });
      }
    }
  }

  // Swing the camera round to look out over the bridges leading on, so you
  // can pick one. Off again with releaseBridges().
  lookAtBridges() {
    const outs = this.bridgesOut.filter(b => b.sign);
    if (!outs.length) return;
    const mid = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const b of outs) {
      mid.add(b.path[0]);
      dir.add(new THREE.Vector3(b.dx, 0, b.dz));
    }
    mid.divideScalar(outs.length);
    dir.normalize();
    // Step back (and up) until every signpost is comfortably on screen.
    const look = mid.clone().addScaledVector(dir, 1.5).add(new THREE.Vector3(0, -0.3, 0));
    const probe = this.camera.clone();
    let pos = null;
    for (let back = 3; back < 20; back += 0.5) {
      pos = mid.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, 1.4 + back * 0.35, 0));
      probe.position.copy(pos);
      probe.lookAt(look);
      probe.updateMatrixWorld();
      const fits = outs.every(b => {
        const v = b.sign.clone().project(probe);
        return Math.abs(v.x) < 0.62 && v.y < 0.75 && v.y > -0.6 && v.z < 1;
      });
      if (fits) break;
    }
    this.viewBridges = { pos, look, lookNow: null };
  }

  releaseBridges() {
    this.viewBridges = null;
  }

  updateBridgeView(dt) {
    const v = this.viewBridges;
    const k = 1 - Math.exp(-dt * 3);
    this.camera.position.lerp(v.pos, k);
    if (!v.lookNow) {
      v.lookNow = new THREE.Vector3();
      this.camera.getWorldDirection(v.lookNow);
      v.lookNow.multiplyScalar(4).add(this.camera.position);
    }
    v.lookNow.lerp(v.look, k);
    this.camera.lookAt(v.lookNow);
  }

  // Signposts on screen, for the labels you tap: [{ x, y, visible }].
  signsOnScreen() {
    return this.bridgesOut.map(b => {
      if (!b.sign) return null;
      const v = b.sign.clone().project(this.camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, visible: v.z < 1 };
    });
  }

  // ---- Travelling between islands ---------------------------------------------

  // Flies the camera along `points` (eased) over `dur` seconds, looking ahead.
  // `cue` ({ t, fn }) runs fn once the flight is t seconds in.
  fly(points, dur, onDone, cue = null) {
    this.cinematic = { points, dur, t: 0, onDone, cue };
  }

  // Off along the n-th bridge leading out of this island. onFade runs
  // towards the end, as the camera reaches the far side.
  flyOut(n, onDone, onFade) {
    this.viewBridges = null;
    const b = this.bridgesOut[n];
    this.cinematicLandsAtBall = false;
    if (!b) return onDone && onDone();
    const pts = [this.camera.position.clone(), ...b.path];
    this.fly(pts, 2.2, onDone, onFade && { t: 1.5, fn: onFade });
  }

  // In along the bridge behind the tee, ending where the normal camera sits.
  flyIn(onDone) {
    const b = this.bridgeIn;
    this.cinematicLandsAtBall = true;
    if (!b) return onDone && onDone();
    const pts = [...b.path].reverse();
    const c = this.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    pts.push(new THREE.Vector3(
      c.target.x - Math.sin(c.yaw) * cp * c.dist,
      c.target.y + sp * c.dist,
      c.target.z - Math.cos(c.yaw) * cp * c.dist,
    ));
    this.fly(pts, 2.0, onDone);
  }

  updateCinematic(dt) {
    const k = this.cinematic;
    k.t += dt;
    const u = Math.min(1, k.t / k.dur);
    const e = u * u * (3 - 2 * u);
    const sample = (v) => {
      const f = Math.min(0.9999, v) * (k.points.length - 1);
      const i = Math.floor(f);
      return k.points[i].clone().lerp(k.points[i + 1], f - i);
    };
    const pos = sample(e);
    const look = e > 0.97 ? this.cam.target.clone() : sample(Math.min(1, e + 0.06)).add(new THREE.Vector3(0, -0.15, 0));
    // As the flight lands, look at the ball rather than the bridge.
    if (k.points === this.cinematic.points && this.cinematicLandsAtBall && e > 0.75) look.lerp(this.cam.target, (e - 0.75) / 0.25);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (k.cue && k.t >= k.cue.t) {
      const fn = k.cue.fn;
      k.cue = null;
      fn();
    }
    if (u >= 1) {
      const done = k.onDone;
      this.cinematic = null;
      if (done) done();
    }
  }

  addWaterfall(g, p) {
    const W = 0.42, H = 5.5;
    // Streaky water that scrolls downwards...
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7fd0f5';
    ctx.fillRect(0, 0, 32, 128);
    const rand = rng(5);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.5})`;
      ctx.fillRect(rand() * 32, rand() * 128, 1 + rand() * 2, 10 + rand() * 30);
    }
    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1, 2.5);
    map.colorSpace = THREE.SRGBColorSpace;
    // ...and fades out as it falls.
    const a = document.createElement('canvas');
    a.width = 4;
    a.height = 64;
    const actx = a.getContext('2d');
    const grad = actx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.6, '#bbbbbb');
    grad.addColorStop(1, '#000000');
    actx.fillStyle = grad;
    actx.fillRect(0, 0, 4, 64);
    const mat = new THREE.MeshBasicMaterial({ map, alphaMap: new THREE.CanvasTexture(a), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    fall.position.set(p.x + p.nx * 0.08, p.y - H / 2 + 0.02, p.z + p.nz * 0.08);
    fall.rotation.y = Math.atan2(p.nx, p.nz);
    g.add(fall);
    // The stream across the rough to the edge.
    const stream = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, 0.7), new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.9 }));
    stream.rotation.x = -Math.PI / 2;
    stream.rotation.z = Math.atan2(p.nx, p.nz);
    const ix = p.x - p.nx * 0.33, iz = p.z - p.nz * 0.33;
    stream.position.set(ix, this.terrain.height(ix, iz) - ROUGH_DROP + 0.015, iz);
    g.add(stream);
    // Spray where it disappears into the clouds below.
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + k * 0.08, 1), lambert('#ffffff', { transparent: true, opacity: 0.7, emissive: '#e8f1fa', emissiveIntensity: 0.4 }));
      m.position.set(p.x + p.nx * 0.2 + (k - 1) * 0.25, p.y - H + 0.4, p.z + p.nz * 0.2);
      m.scale.y = 0.5;
      g.add(m);
    }
    this.falls.push(map);
  }

  // Rails follow the ground, so they climb ramps with it.
  buildRails(g, hole, terrain) {
    const segs = [];
    const pts = hole.shape;
    // No rails where there's open sky beside the fairway, just a post at
    // each end of the open stretch.
    const ends = [];
    for (let i = 0; i < pts.length; i++) {
      for (const s of clipToBands([...pts[i], ...pts[(i + 1) % pts.length]], this.open)) {
        segs.push(s);
        for (const [x, z] of [[s[0], s[1]], [s[2], s[3]]]) {
          if (this.open.some(o => Math.abs(z - o.z1) < 1e-6 || Math.abs(z - o.z2) < 1e-6)) ends.push([x, z]);
        }
      }
    }
    for (const w of hole.walls || []) segs.push(w);
    if (this.theme.cloudy) return this.buildCushions(g, segs, terrain);

    const pos = [], colr = [];
    const quad = (a, b, c, d, color) => {
      pos.push(...a, ...b, ...c, ...c, ...b, ...d);
      for (let k = 0; k < 6; k++) colr.push(color.r, color.g, color.b);
    };
    const h = (x, z) => terrain.height(x, z);
    const posts = [];
    for (const [x1, z1, x2, z2] of segs) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const nx = -uz * WALL_HALF, nz = ux * WALL_HALF;
      const n = Math.max(1, Math.ceil(len / 0.2));
      const sample = t => {
        const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        const y = Math.max(h(x + nx, z + nz), h(x - nx, z - nz));
        return {
          lt: [x + nx, y + RAIL_TOP, z + nz], rt: [x - nx, y + RAIL_TOP, z - nz],
          lb: [x + nx, y + RAIL_BOTTOM, z + nz], rb: [x - nx, y + RAIL_BOTTOM, z - nz],
        };
      };
      let prev = sample(0);
      for (let i = 1; i <= n; i++) {
        const cur = sample(i / n);
        quad(prev.lt, prev.rt, cur.lt, cur.rt, COLORS.rail);
        quad(prev.lb, prev.lt, cur.lb, cur.lt, COLORS.railSide);
        quad(prev.rt, prev.rb, cur.rt, cur.rb, COLORS.railSide);
        prev = cur;
      }
      // Posts go every so often along a run of rail (see below), and at the
      // ends of any extra walls.
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.computeVertexNormals();
    const rails = new THREE.Mesh(geo, lambert('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
    rails.castShadow = true;
    rails.receiveShadow = true;
    rails.userData.glow = '#2f6fa8';
    g.add(rails);

    // Around the outline: a post every ~1.5 m of rail and at sharp corners.
    let run = 0;
    posts.push(...ends);
    const open = z => this.open.some(o => z > o.z1 && z < o.z2);
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[(i + pts.length - 1) % pts.length], [px, pz] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      if (open(pz)) continue;
      const turn = Math.abs(Math.atan2((px - ax) * (bz - pz) - (pz - az) * (bx - px), (px - ax) * (bx - px) + (pz - az) * (bz - pz)));
      if (turn > 0.6 || run > 1.5 || i === 0) {
        posts.push([px, pz]);
        run = 0;
      }
      run += Math.hypot(bx - px, bz - pz);
    }
    for (const [x1, z1, x2, z2] of hole.walls || []) posts.push([x1, z1], [x2, z2]);
    const postGeo = new THREE.CylinderGeometry(WALL_HALF + 0.03, WALL_HALF + 0.035, 0.42, 10);
    const capGeo = new THREE.SphereGeometry(WALL_HALF + 0.03, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const postMat = lambert(COLORS.post);
    const glowPost = { glow: '#ff9a3c' };
    const seen = new Set();
    for (const [x, z] of posts) {
      const key = `${x.toFixed(2)},${z.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const y = h(x, z);
      const p = new THREE.Mesh(postGeo, postMat);
      p.userData = glowPost;
      p.position.set(x, y + 0.0, z);
      p.castShadow = true;
      const cap = new THREE.Mesh(capGeo, postMat);
      cap.userData = glowPost;
      cap.position.set(x, y + 0.21, z);
      g.add(p, cap);
    }
  }

  // Puffy cloud cushions in place of rails.
  buildCushions(g, segs, terrain) {
    const spots = [];
    for (const [x1, z1, x2, z2] of segs) {
      const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 0.16));
      for (let i = 0; i < n; i++) spots.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n]);
    }
    const puffs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      lambert('#ffffff', { emissive: '#eef4fb', emissiveIntensity: 0.45 }),
      spots.length,
    );
    const m = new THREE.Matrix4(), rand = rng(3);
    spots.forEach(([x, z], i) => {
      const s = 0.85 + rand() * 0.5;
      m.makeScale(s, s * 0.85, s).setPosition(x, terrain.height(x, z) + 0.06, z);
      puffs.setMatrixAt(i, m);
    });
    puffs.castShadow = true;
    g.add(puffs);
  }

  buildWater(g, hole, terrain) {
    this.waters = [];
    for (const zone of hole.zones || []) {
      if (zone.type !== 'water') continue;
      // Sit the surface just under the lowest point of the bank.
      let level = Infinity;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        level = Math.min(level, terrain.height(zone.x + Math.cos(a) * zone.w / 2, zone.z + Math.sin(a) * zone.d / 2));
      }
      const geo = new THREE.CircleGeometry(1, 48);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: '#4cb6e8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88,
        emissive: '#1d6f9e', emissiveIntensity: 0.25,
      });
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(zone.w / 2, 1, zone.d / 2);
      m.position.set(zone.x, level - 0.035, zone.z);
      m.receiveShadow = true;
      g.add(m);
      this.waters.push({ mesh: m, level: level - 0.035, zone });
    }
  }

  buildCup(g, hole, terrain) {
    const [cx, cz] = hole.cup;
    const y = terrain.cupLevel;
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(CUP_R, CUP_R, 0.32, 32, 1, true),
      lambert('#3b3f45', { side: THREE.BackSide }),
    );
    liner.position.set(cx, y - 0.16, cz);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 32), lambert('#25282c'));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(cx, y - 0.31, cz);
    const rim = new THREE.Mesh(new THREE.RingGeometry(CUP_R - 0.005, CUP_R + 0.03, 40), lambert('#ffffff'));
    rim.userData.glow = '#ffffff';
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(cx, y + 0.004, cz);
    g.add(liner, bottom, rim);

    // The flag lifts out as the ball gets close.
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.35, 8), lambert('#f4f4f4'));
    pole.position.y = 0.43;
    pole.castShadow = true;
    const clothGeo = new THREE.PlaneGeometry(0.46, 0.3, 10, 4);
    clothGeo.translate(0.23, 0, 0);
    const cloth = new THREE.Mesh(clothGeo, lambert('#ff4f5e', { side: THREE.DoubleSide, emissive: '#7a1822' }));
    cloth.position.y = 0.95;
    cloth.castShadow = true;
    this.clothBase = Float32Array.from(clothGeo.attributes.position.array);
    flag.add(pole, cloth);
    flag.position.set(cx, y - 0.25, cz);
    g.add(flag);
    this.flag = { group: flag, cloth, lift: 0, baseY: y - 0.25 };
  }

  buildObstacles(g, hole, terrain) {
    this.spinners = (hole.spinners || []).map(s => {
      const grp = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.38, 14), lambert(this.theme.spinnerStyle === 'crystal' ? '#5a3f8a' : '#ffd23f'));
      hub.position.y = 0.12;
      hub.castShadow = true;
      const bar = new THREE.Group();
      const segN = 6;
      for (let i = 0; i < segN; i++) {
        const crystal = this.theme.spinnerStyle === 'crystal';
        const color = crystal ? CRYSTAL_COLORS[i % 2] : i % 2 ? '#ffffff' : '#ef476f';
        const piece = new THREE.Mesh(
          crystal ? new THREE.OctahedronGeometry(1, 0) : new THREE.BoxGeometry((s.len * 2) / segN, 0.13, 0.14),
          crystal
            ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.2, flatShading: true })
            : lambert(color),
        );
        if (crystal) piece.scale.set(s.len / segN + 0.02, 0.09, 0.09);
        piece.position.x = -s.len + (s.len * 2 * (i + 0.5)) / segN;
        piece.castShadow = true;
        bar.add(piece);
      }
      bar.position.y = 0.09;
      grp.add(hub, bar);
      grp.position.set(s.x, terrain.height(s.x, s.z), s.z);
      g.add(grp);
      return { s, grp };
    });
    this.movers = (hole.movers || []).map(m => {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(m.w, 0.3, m.d),
        new THREE.MeshStandardMaterial({ color: '#7b61ff', roughness: 0.5 }),
      );
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(m.w + 0.004, 0.06, m.d + 0.004), lambert('#ffd23f'));
      stripe.position.y = 0.06;
      block.add(stripe);
      block.castShadow = true;
      block.receiveShadow = true;
      block.userData.glow = '#5a40d0';
      g.add(block);
      return { m, block };
    });
  }

  // A chasm right across the fairway, with a hazard stripe on each lip.
  buildGaps(g, hole, terrain) {
    const dark = lambert(this.theme.chasm.wall, { side: THREE.DoubleSide });
    // A lava floor glows; others are just dark.
    const deep = new THREE.MeshBasicMaterial({ color: this.theme.chasm.floor });
    for (const gp of hole.gaps || []) {
      // The chasm runs between the rails where it crosses the fairway.
      const [x0, x1] = spanAt(hole.shape, (gp.z1 + gp.z2) / 2);
      const w = x1 - x0, mid = (x0 + x1) / 2, depth = 1.6;
      for (const z of [gp.z1, gp.z2]) {
        const y = terrain.height(mid, z);
        // The stripe spans the fairway at the lip itself (which differs
        // from the middle of the gap when the gap runs on a slant).
        const [l0, l1] = spanAt(hole.shape, z + (z === gp.z1 ? -0.01 : 0.01));
        if (!gp.split) {
          const face = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), dark);
          face.position.set(mid, y - depth / 2, z);
          g.add(face);
        }
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(l1 - l0 - 0.1, 0.02, 0.08), lambert('#ffd23f'));
        stripe.position.set((l0 + l1) / 2, terrain.height((l0 + l1) / 2, z) + 0.005, z + (z === gp.z1 ? -0.04 : 0.04));
        g.add(stripe);
      }
      // A split gap opens onto the sky: nothing more to draw.
      if (gp.split) continue;
      const yb = Math.min(terrain.height(mid, gp.z1), terrain.height(mid, gp.z2)) - depth;
      const len = gp.z2 - gp.z1;
      for (const x of [x0, x1]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(len, depth), dark);
        side.rotation.y = Math.PI / 2;
        side.position.set(x, yb + depth / 2, (gp.z1 + gp.z2) / 2);
        g.add(side);
      }
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, len), deep);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(mid, yb, (gp.z1 + gp.z2) / 2);
      g.add(floor);
    }
  }

  // A plank bridge you putt along: the deck follows the ground (so it sags
  // as the hole says), on two ropes, with rope handrails too high to stop a
  // ball rolling off the side.
  buildRopeBridges(g, hole, terrain) {
    const rand = rng(23);
    const plankMat = lambert('#9b7048', { flatShading: true });
    const ropeMat = lambert('#d9c8a0');
    const postMat = lambert('#6b4a2c');
    const rope = (pts, r = 0.018) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 5), ropeMat);
      m.castShadow = true;
      g.add(m);
    };
    for (const br of hole.ropeBridges || []) {
      const len = br.z2 - br.z1;
      const n = Math.round(len / 0.2);
      const span = z => spanAt(hole.shape, z);
      for (let i = 0; i < n; i++) {
        const z = br.z1 + (i + 0.5) * (len / n);
        const [x0, x1] = span(z);
        const mid = (x0 + x1) / 2;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.12, 0.05, (len / n) * 0.86), plankMat);
        plank.position.set(mid + (rand() - 0.5) * 0.03, terrain.height(mid, z) - 0.025, z);
        plank.rotation.set(-Math.atan(terrain.grad(mid, z)[1]), (rand() - 0.5) * 0.04, 0);
        plank.castShadow = true;
        plank.receiveShadow = true;
        g.add(plank);
      }
      for (const side of [-1, 1]) {
        const edgeX = z => {
          const [x0, x1] = span(Math.min(br.z2 - 1e-3, Math.max(br.z1 + 1e-3, z)));
          return side < 0 ? x0 - 0.08 : x1 + 0.08;
        };
        // Under the plank ends, and a handrail that sags a little more.
        const under = [], rail = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, z = br.z1 - 0.15 + (len + 0.3) * t;
          const x = edgeX(z), y = terrain.height(x, z);
          under.push(new THREE.Vector3(x, y - 0.06, z));
          rail.push(new THREE.Vector3(x, y + 0.55 - 0.12 * 4 * t * (1 - t), z));
        }
        rope(under, 0.022);
        rope(rail);
        for (let i = 2; i < 24; i += 2) {
          const top = rail[i], low = under[i];
          const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, top.y - low.y, 4), ropeMat);
          hanger.position.set(top.x, (top.y + low.y) / 2, top.z);
          g.add(hanger);
        }
        for (const z of [br.z1 - 0.15, br.z2 + 0.15]) {
          const x = edgeX(z), y = terrain.height(x, z);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.8, 6), postMat);
          post.position.set(x, y + 0.25, z);
          post.castShadow = true;
          g.add(post);
        }
      }
    }
  }

  // A little Dutch windmill: walls with a tunnel through, a roof, and four
  // sails turning across the doorway.
  buildWindmills(g, hole, terrain) {
    this.windmills = (hole.windmills || []).map(w => {
      const grp = new THREE.Group();
      const y = terrain.height(w.x, w.z);
      const H = 1.25, doorH = 0.36, t = w.door / 2;
      const wall = lambert('#f6efe2');
      const sideW = w.w / 2 - t;
      for (const sx of [-1, 1]) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(sideW, H, w.d), wall);
        block.position.set(sx * (t + sideW / 2), H / 2, 0);
        block.castShadow = true;
        block.receiveShadow = true;
        grp.add(block);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(w.door, H - doorH, w.d), wall);
      lintel.position.set(0, doorH + (H - doorH) / 2, 0);
      lintel.castShadow = true;
      grp.add(lintel);
      const tunnel = new THREE.Mesh(new THREE.BoxGeometry(w.door, doorH, w.d), lambert('#2d2a28', { side: THREE.BackSide }));
      tunnel.position.set(0, doorH / 2, 0);
      grp.add(tunnel);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w.w, w.d) / 2 + 0.08, 0.9, 4), lambert('#d9573b', { flatShading: true }));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = H + 0.45;
      roof.castShadow = true;
      grp.add(roof);
      // Sails, on a hub in front of the wall facing the tee.
      const sails = new THREE.Group();
      sails.position.set(0, 1.0, -w.d / 2 - 0.12);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12), lambert('#5b3a24'));
      hub.rotation.x = Math.PI / 2;
      sails.add(hub);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group();
        arm.rotation.z = (k * Math.PI) / 2;
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.04), lambert('#5b3a24'));
        spar.position.y = 0.5;
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.015), lambert(k % 2 ? '#ffffff' : '#ef476f'));
        cloth.position.set(-0.13, 0.58, 0);
        spar.castShadow = cloth.castShadow = true;
        arm.add(spar, cloth);
        sails.add(arm);
      }
      grp.add(sails);
      grp.position.set(w.x, y, w.z);
      g.add(grp);
      return { w, sails };
    });
  }

  buildBumpers(g, hole, terrain) {
    const style = this.theme.bumperStyle;
    this.bumpers = (hole.bumpers || []).map(bp => {
      const grp = new THREE.Group();
      if (style === 'mushroom' || style === 'puff') {
        grp.position.set(bp.x, terrain.height(bp.x, bp.z), bp.z);
        g.add(grp);
        return { grp, mat: this.styledBumper(grp, bp, style), flash: 0 };
      }
      const mat = new THREE.MeshStandardMaterial({ color: '#ef476f', emissive: '#ff2e63', emissiveIntensity: 0, roughness: 0.4 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(bp.r, bp.r * 1.05, 0.2, 24), mat);
      body.position.y = 0.1;
      body.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(bp.r * 0.75, bp.r * 0.8, 0.05, 24), lambert('#ffffff'));
      cap.position.y = 0.22;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(bp.r, 0.025, 8, 28), lambert('#ffd23f'));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      grp.add(body, cap, ring);
      grp.position.set(bp.x, terrain.height(bp.x, bp.z), bp.z);
      g.add(grp);
      return { grp, mat, flash: 0 };
    });
  }

  // A bouncy mushroom or a cloud puff in place of a pinball bumper. Returns
  // the material that flashes on a hit.
  styledBumper(grp, bp, style) {
    if (style === 'puff') {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3b0', emissiveIntensity: 0, roughness: 0.9, flatShading: true });
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(bp.r * (k ? 0.7 : 1), 1), mat);
        m.position.set(k ? Math.cos(k * 2.1) * bp.r * 0.6 : 0, bp.r * (k ? 0.55 : 0.6), k ? Math.sin(k * 2.1) * bp.r * 0.6 : 0);
        m.scale.y = 0.8;
        m.castShadow = true;
        grp.add(m);
      }
      return mat;
    }
    const h = 0.32;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(bp.r * 0.55, bp.r * 0.7, h, 12), lambert('#f4ead8'));
    stem.position.y = h / 2;
    const mat = new THREE.MeshStandardMaterial({ color: '#e63946', emissive: '#ff4d6d', emissiveIntensity: 0, roughness: 0.5 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(bp.r * 1.25, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.position.y = h - 0.03;
    cap.scale.y = 0.75;
    cap.castShadow = stem.castShadow = true;
    grp.add(stem, cap);
    const spot = lambert('#ffffff');
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, e = 0.6;
      const d = new THREE.Mesh(new THREE.SphereGeometry(bp.r * 0.16, 6, 4), spot);
      d.position.set(Math.cos(a) * Math.cos(e) * bp.r * 1.25, h - 0.03 + Math.sin(e) * bp.r * 0.95, Math.sin(a) * Math.cos(e) * bp.r * 1.25);
      grp.add(d);
    }
    return mat;
  }

  // Green warp pipes: a mouth in the ground and a stub the ball pops out of.
  buildPipes(g, hole, terrain) {
    const green = lambert('#2fb34a');
    const inside = lambert('#14301b', { side: THREE.BackSide });
    for (const p of hole.pipes || []) {
      const [fx, fz] = p.from, [tx, tz] = p.to;
      const yf = terrain.height(fx, fz), yt = terrain.height(tx, tz);
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(PIPE_R, PIPE_R, 0.5, 28, 1, true), inside);
      liner.position.set(fx, yf - 0.25, fz);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(PIPE_R + 0.03, 0.045, 10, 32), green);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(fx, yf + 0.02, fz);
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(PIPE_R, 28), lambert('#0b1a0f'));
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(fx, yf - 0.48, fz);
      rim.userData.glow = '#1fbf4a';
      g.add(liner, rim, bottom);

      const stub = new THREE.Mesh(new THREE.CylinderGeometry(PIPE_R, PIPE_R, 0.28, 28), green);
      stub.position.set(tx, yt + 0.14, tz);
      stub.castShadow = true;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(PIPE_R + 0.02, 0.05, 10, 32), green);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(tx, yt + 0.28, tz);
      const top = new THREE.Mesh(new THREE.CircleGeometry(PIPE_R - 0.02, 28), lambert('#0b1a0f'));
      top.rotation.x = -Math.PI / 2;
      top.position.set(tx, yt + 0.285, tz);
      stub.userData.glow = lip.userData.glow = '#1fbf4a';
      g.add(stub, lip, top);
    }
  }

  // Ice: a glossy, see-through slab just proud of the grass, with streaks,
  // cracks, a frosted edge and twinkling glints, so it reads as slippery.
  buildIce(g, hole, terrain) {
    this.glints = [];
    const rand = rng(77);
    const glintGeo = new THREE.OctahedronGeometry(0.035, 0);
    const glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const addGlint = (x, z) => {
      const m = new THREE.Mesh(glintGeo, glintMat);
      m.position.set(x, terrain.renderHeight(x, z) + 0.03, z);
      g.add(m);
      this.glints.push({ m, phase: rand() * Math.PI * 2, rate: 1.5 + rand() * 2 });
    };
    // A frozen fairway sparkles all over.
    if (this.pal.sparkle) {
      const b = this.bounds;
      for (let i = 0; i < 120; i++) {
        const x = b.x0 + rand() * (b.x1 - b.x0), z = b.z0 + rand() * (b.z1 - b.z0);
        if (insidePolygon(hole.shape, x, z) && terrain.surfaceAt(x, z) !== 'water') addGlint(x, z);
      }
    }
    for (const zone of hole.zones || []) {
      if (zone.type !== 'ice' || !zone.rect) continue;
      const nx = Math.max(2, Math.round(zone.w / 0.1)), nz = Math.max(2, Math.round(zone.d / 0.1));
      const geo = new THREE.PlaneGeometry(zone.w, zone.d, nx, nz);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = zone.x + pos.getX(i), z = zone.z + pos.getZ(i);
        pos.setY(i, terrain.renderHeight(x, z) + 0.012);
      }
      geo.computeVertexNormals();
      const slab = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: iceTexture(zone.w / zone.d), roughness: 0.08, metalness: 0.2,
        transparent: true, opacity: 0.92, emissive: '#cdeeff', emissiveIntensity: 0.18,
      }));
      slab.position.set(zone.x, 0, zone.z);
      slab.receiveShadow = true;
      g.add(slab);

      const frost = lambert('#f4fbff', { emissive: '#bfe6ff', emissiveIntensity: 0.4 });
      for (const sx of [-1, 1]) {
        const x = zone.x + (sx * zone.w) / 2;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, zone.d), frost);
        edge.position.set(x, terrain.renderHeight(x, zone.z) + 0.015, zone.z);
        g.add(edge);
      }
      for (let i = 0; i < Math.round(zone.w * zone.d * 4); i++) {
        addGlint(zone.x + (rand() - 0.5) * zone.w * 0.9, zone.z + (rand() - 0.5) * zone.d * 0.95);
      }
    }
  }

  // A puff of frost behind a ball sliding on ice.
  frost(x, z) {
    const y = this.terrain.height(x, z) + 0.03;
    this.burst(x, y, z, { count: 3, colors: ['#ffffff', '#d7f2fb'], speed: 0.3, up: 0.5, life: 0.5, size: 0.035, gravity: 1 });
  }

  // A few bursts of colour high over the cup (the night hole's finish).
  fireworks(x, z) {
    this.fwQueue = this.fwQueue || [];
    const hues = ['#ff4f5e', '#ffd23f', '#06d6a0', '#4cc9f0', '#b388ff', '#ff8c1a'];
    for (let i = 0; i < 7; i++) {
      this.fwQueue.push({
        t: 0.15 + i * 0.35 + Math.random() * 0.2,
        x: x + (Math.random() - 0.5) * 4, y: this.terrain.cupLevel + 2.5 + Math.random() * 2, z: z + 1 + Math.random() * 3,
        color: hues[i % hues.length],
      });
    }
  }

  updateFireworks(dt) {
    if (!this.fwQueue || !this.fwQueue.length) return;
    for (const f of this.fwQueue) f.t -= dt;
    for (const f of this.fwQueue.filter(q => q.t <= 0)) {
      this.burst(f.x, f.y, f.z, { count: 60, colors: [f.color, f.color, '#ffffff'], speed: 2.6, up: 1.2, life: 1.6, size: 0.07, gravity: 1.8 });
      if (this.onFirework) this.onFirework();
    }
    this.fwQueue = this.fwQueue.filter(q => q.t > 0);
  }

  bumperHit(i) {
    const b = this.bumpers && this.bumpers[i];
    if (b) b.flash = 1;
  }

  warpPuff(x, z) {
    const y = this.terrain.height(x, z) + 0.2;
    this.burst(x, y, z, { count: 16, colors: ['#ffffff', '#9ff0a8', '#2fb34a'], speed: 1.0, up: 1.6, life: 0.6, size: 0.05, gravity: 3 });
  }

  buildScenery(g, hole, terrain, island, index) {
    const rand = rng(1000 + index * 31);
    const theme = this.theme;
    const placed = [];
    const area = (island.x1 - island.x0) * (island.z1 - island.z0);
    const tries = Math.round(area * 0.5);
    for (let i = 0; i < tries && placed.length < 28; i++) {
      const x = island.x0 + rand() * (island.x1 - island.x0);
      const z = island.z0 + rand() * (island.z1 - island.z0);
      if (!island.inside(x, z, 0.35)) continue;
      if (insidePolygon(hole.shape, x, z)) continue;
      const edge = nearestOnPolygon(hole.shape, x, z).dist;
      if (edge < 0.55) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.9)) continue;
      placed.push([x, z]);
      // Keep tall things away from the rails so they don't block the view.
      const obj = theme.scenery(this, rand, edge > 1.1);
      if (!obj) continue;
      obj.position.set(x, terrain.height(x, z) - ROUGH_DROP, z);
      g.add(obj);
    }
    // Small details dotted around the rough: flowers, leaves, shells...
    for (let i = 0; i < theme.flora.count; i++) {
      const x = island.x0 + rand() * (island.x1 - island.x0);
      const z = island.z0 + rand() * (island.z1 - island.z0);
      if (!island.inside(x, z, 0.15) || insidePolygon(hole.shape, x, z)) continue;
      if (nearestOnPolygon(hole.shape, x, z).dist < 0.2) continue;
      const f = theme.flora.make(rand);
      f.position.x += x;
      f.position.y += terrain.height(x, z) - ROUGH_DROP;
      f.position.z += z;
      g.add(f);
    }
  }

  // ---- Aim -------------------------------------------------------------------

  buildAim() {
    const N = 36;
    this.aimDots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.03, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false }),
      N,
    );
    this.aimDots.renderOrder = 5;
    this.aimDots.count = 0;
    this.aimDots.frustumCulled = false;
    this.scene.add(this.aimDots);

    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.25, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
    );
    this.aimRing.renderOrder = 4;
    this.aimRing.visible = false;
    this.scene.add(this.aimRing);
    this.ringBack = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.25, 48),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthTest: false, side: THREE.DoubleSide }),
    );
    this.ringBack.renderOrder = 3;
    this.ringBack.visible = false;
    this.scene.add(this.ringBack);

    // A pulsing ring that marks the ball in the overview, where it's tiny.
    this.ballMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.32, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }),
    );
    this.ballMarker.rotation.x = -Math.PI / 2;
    this.ballMarker.renderOrder = 6;
    this.ballMarker.visible = false;
    this.scene.add(this.ballMarker);
    this.ringPower = -1;
  }

  // path: [[x, z], ...] from the ball outwards. power 0..1.
  showAim(path, power) {
    const color = powerColor(power);
    const m = SCRATCH.m;
    const n = Math.min(path.length, this.aimDots.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const [x, z] = path[i];
      const s = 1 - (i / n) * 0.45;
      m.makeScale(s, s, s);
      m.setPosition(x, this.terrain.height(x, z) + BALL_R * 0.6, z);
      this.aimDots.setMatrixAt(i, m);
      this.aimDots.setColorAt(i, color);
    }
    this.aimDots.count = n;
    this.aimDots.instanceMatrix.needsUpdate = true;
    if (this.aimDots.instanceColor) this.aimDots.instanceColor.needsUpdate = true;

    const p = Math.round(power * 100) / 100;
    if (p !== this.ringPower) {
      this.ringPower = p;
      this.aimRing.geometry.dispose();
      this.aimRing.geometry = new THREE.RingGeometry(0.2, 0.25, 48, 1, Math.PI / 2, -Math.max(0.001, p) * Math.PI * 2);
    }
    this.aimRing.material.color.copy(color);
    for (const r of [this.aimRing, this.ringBack]) {
      r.visible = true;
      r.position.set(this.ball.position.x, this.ball.position.y - BALL_R + 0.02, this.ball.position.z);
      r.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  hideAim() {
    this.aimDots.count = 0;
    this.aimRing.visible = false;
    this.ringBack.visible = false;
  }

  // ---- Effects -----------------------------------------------------------------

  burst(x, y, z, { count, colors, speed, up, life, size, gravity = 9 }) {
    // One flake shape per size, shared by every burst.
    this.flakes = this.flakes || {};
    const geo = this.flakes[size] || (this.flakes[size] = new THREE.BoxGeometry(size, size * 0.3, size * 0.7));
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
      mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.particles.push({
        mesh, life, age: 0, gravity,
        v: new THREE.Vector3(Math.cos(a) * s, up * (0.6 + Math.random() * 0.6), Math.sin(a) * s),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
      });
    }
  }

  confetti(x, z) {
    this.burst(x, this.terrain.cupLevel + 0.1, z, {
      count: 90, colors: ['#ef476f', '#ffd23f', '#06d6a0', '#118ab2', '#ffffff', '#b39cff'],
      speed: 2.4, up: 5, life: 2.6, size: 0.07, gravity: 5,
    });
  }

  splash(x, z) {
    const w = this.waters.find(w => zoneContains(w.zone, x, z)) || this.waters[0];
    const y = w ? w.level : this.terrain.height(x, z);
    this.burst(x, y, z, { count: 30, colors: ['#ffffff', '#bfe9ff', '#7cd0ff'], speed: 1.2, up: 3, life: 0.9, size: 0.05 });
  }

  // ---- Camera ------------------------------------------------------------------

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 52;
    this.camera.updateProjectionMatrix();
  }

  // World direction for a drag on screen. Pulling the pointer down the screen
  // shoots the ball up the screen, as with a slingshot.
  dragToAngle(dx, dy) {
    const yaw = this.cam.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -fz, rz = fx;
    const sx = -rx * dx + fx * dy, sz = -rz * dx + fz * dy;
    return Math.atan2(sx, sz);
  }

  // Where the ball is on screen, in CSS pixels.
  ballScreen() {
    SCRATCH.v.copy(this.ball.position).project(this.camera);
    return { x: ((SCRATCH.v.x + 1) / 2) * innerWidth, y: ((1 - SCRATCH.v.y) / 2) * innerHeight };
  }

  // Starting pitch and distance for the follow camera.
  defaultView() {
    const a = this.camera.aspect;
    if (a < 1) return { pitch: 0.66, dist: 6.2 };
    // Wide, short screens (a phone held sideways) sit a little higher and look
    // further ahead (see updateCamera), so the cup stays in view.
    return a > 1.7 ? { pitch: 0.6, dist: 6.4 } : { pitch: 0.58, dist: 5 };
  }

  // Distance at which the whole hole fits on screen, measured along the
  // camera's own axes (so a long hole fills a tall phone screen).
  overviewFit() {
    const yaw = this.cam.yaw, pitch = this.cam.want.pitch;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let across = 0, along = 0;
    for (const [x, z] of this.hole.shape) {
      const dx = x - this.bounds.cx, dz = z - this.bounds.cz;
      across = Math.max(across, Math.abs(dx * fz - dz * fx));
      along = Math.max(along, Math.abs(dx * fx + dz * fz));
    }
    across += 0.8;
    along = along * Math.sin(pitch) + 0.8;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    // Leave room for the HUD at the top and the buttons at the bottom.
    return Math.max(across / Math.tan(hfov / 2), along / Math.tan(vfov / 2) / 0.8);
  }

  updateCamera(dt, focus) {
    if (this.cinematic) return this.updateCinematic(dt);
    if (this.viewBridges) return this.updateBridgeView(dt);
    const c = this.cam, want = c.want;
    if (c.overview) {
      const b = this.bounds;
      want.target.set(b.cx, this.terrain.height(b.cx, b.cz), b.cz);
      want.pitch = 1.25;
      want.dist = this.overviewFit();
    } else {
      // Look past the ball, in the direction the camera faces. On a tall
      // phone screen look further ahead, so the ball sits low and the hole
      // fills the screen.
      const a = this.camera.aspect;
      const ahead = a < 1 ? 2.0 : a > 1.7 ? 1.0 : 1.1;
      want.target.set(
        focus.x + Math.sin(c.yaw) * ahead,
        focus.y,
        focus.z + Math.cos(c.yaw) * ahead,
      );
    }
    const k = 1 - Math.exp(-dt * (c.overview ? 5 : 6));
    c.target.lerp(want.target, k);
    c.pitch += (want.pitch - c.pitch) * k;
    c.dist += (want.dist - c.dist) * k;
    let dy = want.yaw - c.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw += dy * (1 - Math.exp(-dt * 8));

    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const px = c.target.x - Math.sin(c.yaw) * cp * c.dist;
    const pz = c.target.z - Math.cos(c.yaw) * cp * c.dist;
    let py = c.target.y + sp * c.dist;
    // Never dip under the ground (or the rough beyond the rails).
    const ground = this.terrain.height(px, pz) + 0.45;
    if (py < ground) py = ground;
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(c.target);
  }

  // ---- Per frame -----------------------------------------------------------------

  update(dt, sim, ballPos, ballVel) {
    this.time += dt;
    const t = sim.t;

    // Ball: placed and rolled by main.js (it also animates the drop into the cup).
    this.ball.position.copy(ballPos);
    if (ballVel) {
      const sp = Math.hypot(ballVel.x, ballVel.z);
      if (sp > 1e-4) {
        SCRATCH.v.set(ballVel.z / sp, 0, -ballVel.x / sp);
        SCRATCH.q.setFromAxisAngle(SCRATCH.v, (sp * dt) / BALL_R);
        this.ball.quaternion.premultiply(SCRATCH.q);
      }
    }

    const marker = this.ballMarker;
    marker.visible = this.cam.overview && this.showMarker;
    if (marker.visible) {
      marker.position.set(ballPos.x, ballPos.y - BALL_R + 0.02, ballPos.z);
      marker.scale.setScalar(Math.max(1, this.cam.dist / 7) * (1 + 0.15 * Math.sin(this.time * 5)));
    }

    for (const { s, grp } of this.spinners) grp.rotation.y = -spinnerAngle(s, t);
    for (const { w, sails } of this.windmills) sails.rotation.z = windmillAngle(w, t);
    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - dt * 4);
      b.mat.emissiveIntensity = b.flash * 1.2;
      b.grp.scale.setScalar(1 + b.flash * 0.12);
    }
    for (const { m, block } of this.movers) {
      const st = moverState(m, t);
      block.position.set(st.x, this.terrain.height(st.x, st.z) + 0.15, st.z);
    }

    // Flag: rises when the ball comes close so it never blocks the drop.
    const [cx, cz] = this.hole.cup;
    const near = Math.hypot(ballPos.x - cx, ballPos.z - cz) < 1.3 ? 1 : 0;
    this.flag.lift += (near - this.flag.lift) * (1 - Math.exp(-dt * 5));
    this.flag.group.position.y = this.flag.baseY + this.flag.lift * 0.9;
    this.flag.group.rotation.y = 0.6 + Math.sin(this.time * 0.4) * 0.15;
    const pos = this.flag.cloth.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.clothBase[i * 3];
      pos.setZ(i, Math.sin(bx * 9 - this.time * 6) * 0.04 * (bx / 0.46));
    }
    pos.needsUpdate = true;

    if (this.drift && !reduceMotion) this.drift.update(dt, this.time);
    for (const f of this.floaters || []) f.obj.position.y = f.baseY + Math.sin(this.time * f.rate + f.phase) * f.amp;
    for (const map of this.falls || []) map.offset.y += dt * 1.4;
    if (this.themeUpdate) this.themeUpdate(dt, this.time);
    this.updateFireworks(dt);

    for (const gl of this.glints) {
      const s = Math.pow(Math.max(0, Math.sin(this.time * gl.rate + gl.phase)), 12);
      gl.m.scale.set(s, s * 0.3, s);
    }

    for (const w of this.waters) {
      w.mesh.material.emissiveIntensity = 0.22 + Math.sin(this.time * 1.6) * 0.06;
    }

    for (const c of this.sky.children) {
      if (c.userData.bob !== undefined) c.position.y = c.userData.baseY + Math.sin(this.time * 0.5 + c.userData.bob) * 0.25;
    }
    this.sky.rotation.y = this.time * 0.006;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      p.v.y -= p.gravity * dt;
      p.v.multiplyScalar(1 - 0.8 * dt);
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.material.opacity = 1 - smooth((p.age - p.life * 0.6) / (p.life * 0.4));
      if (p.age > p.life) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

const SCRATCH = { v: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() };
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Where an outline crosses the line at z: its leftmost and rightmost x.
function spanAt(pts, z) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    if ((z1 - z) * (z2 - z) > 0 || z1 === z2) continue;
    const x = x1 + ((z - z1) / (z2 - z1)) * (x2 - x1);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo, hi];
}

// 0..1 across the edge of a zone, for painting.
function zoneEdge(zone, x, z) {
  const dx = Math.abs(x - zone.x) / (zone.w / 2), dz = Math.abs(z - zone.z) / (zone.d / 2);
  const d = zone.rect ? Math.max(dx, dz) : Math.sqrt(dx * dx + dz * dz);
  return smooth((1 - d) / 0.08);
}

export function powerColor(p) {
  const c = new THREE.Color();
  if (p < 0.5) c.set('#5ee07a').lerp(new THREE.Color('#ffd23f'), p / 0.5);
  else c.set('#ffd23f').lerp(new THREE.Color('#ff4f5e'), (p - 0.5) / 0.5);
  return c;
}
