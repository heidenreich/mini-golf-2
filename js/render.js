import * as THREE from '../vendor/three.module.min.js';
import { insidePolygon, zoneContains, smooth } from './terrain.js';
import { BALL_R, CUP_R, PIPE_R, WALL_HALF, spinnerAngle, moverState, windmillAngle } from './physics.js';

// Draws a hole and everything on it. Nothing in here affects the game:
// physics and rules live in physics.js and main.js.

const GRID = 0.1;            // ground mesh resolution (m)
const ISLAND_MARGIN = 1.9;   // rough grass between the rails and the island's edge
const ISLAND_CORNER = 1.6;
const ROUGH_DROP = 0.05;     // rough sits a touch below the fairway
const RAIL_TOP = 0.13;
const RAIL_BOTTOM = -0.22;

const COLORS = {
  grassA: new THREE.Color('#79c94f'),
  grassB: new THREE.Color('#6bbb45'),
  rough: new THREE.Color('#5aa63c'),
  roughDark: new THREE.Color('#4c9434'),
  sand: new THREE.Color('#ead59a'),
  ice: new THREE.Color('#d7f2fb'),
  pondBed: new THREE.Color('#3d8a8f'),
  rail: new THREE.Color('#fbf3e4'),
  railSide: new THREE.Color('#e6d6b8'),
  post: new THREE.Color('#d9573b'),
  dirtTop: new THREE.Color('#9a6a42'),
  dirt: new THREE.Color('#7d5536'),
  rock: new THREE.Color('#7b7f86'),
  skyTop: '#5fb3ec',
  skyBottom: '#d9f0ff',
};

// Ground colours for each look.
const PALETTES = {
  summer: { grassA: COLORS.grassA, grassB: COLORS.grassB, rough: COLORS.rough, roughDark: COLORS.roughDark, green: new THREE.Color('#86d35b') },
  winter: {
    grassA: new THREE.Color('#e4f4fc'), grassB: new THREE.Color('#d2eaf7'),
    rough: new THREE.Color('#f5f9fc'), roughDark: new THREE.Color('#dde7ef'), green: new THREE.Color('#ffffff'),
  },
};

// Small deterministic random numbers, so each hole's scenery is the same
// every time you play it.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// The island under a hole is a rounded rectangle around its rails.
function makeIsland(b) {
  const x0 = b.x0 - ISLAND_MARGIN, x1 = b.x1 + ISLAND_MARGIN;
  const z0 = b.z0 - ISLAND_MARGIN, z1 = b.z1 + ISLAND_MARGIN;
  const r = ISLAND_CORNER;
  const core = (x, z) => [Math.max(x0 + r, Math.min(x1 - r, x)), Math.max(z0 + r, Math.min(z1 - r, z))];
  return {
    x0, x1, z0, z1,
    inside(x, z, inset = 0) {
      const [qx, qz] = core(x, z);
      return Math.hypot(x - qx, z - qz) <= r - inset && x >= x0 + inset && x <= x1 - inset && z >= z0 + inset && z <= z1 - inset;
    },
    snap(x, z) {
      const [qx, qz] = core(x, z);
      const d = Math.hypot(x - qx, z - qz);
      if (d <= r) return [x, z];
      return [qx + ((x - qx) * r) / d, qz + ((z - qz) * r) / d];
    },
    outline(step) {
      const pts = [];
      const arc = (cx, cz, a0) => {
        const n = Math.max(4, Math.round((Math.PI / 2 * r) / step));
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * (Math.PI / 2);
          pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
        }
      };
      const edge = (ax, az, bx, bz) => {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
        for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
      };
      edge(x0 + r, z0, x1 - r, z0); arc(x1 - r, z0 + r, -Math.PI / 2);
      edge(x1, z0 + r, x1, z1 - r); arc(x1 - r, z1 - r, 0);
      edge(x1 - r, z1, x0 + r, z1); arc(x0 + r, z1 - r, Math.PI / 2);
      edge(x0, z1 - r, x0, z0 + r); arc(x0 + r, z0 + r, Math.PI);
      return pts;
    },
  };
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

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, COLORS.skyTop);
  grad.addColorStop(0.65, COLORS.skyBottom);
  grad.addColorStop(1, '#f6fbff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
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

function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

export class World {
  constructor(canvas) {
    const lowPower = Math.min(screen.width, screen.height) < 500;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 2 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(COLORS.skyBottom, 35, 95);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.cam = {
      yaw: 0, pitch: 0.58, dist: 5,
      target: new THREE.Vector3(),
      want: { yaw: 0, pitch: 0.58, dist: 5, target: new THREE.Vector3() },
      overview: false,
    };

    const hemi = new THREE.HemisphereLight('#e4f3ff', '#5f8a3e', 0.95);
    this.scene.add(hemi);
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
    const cloudMat = lambert('#ffffff', { flatShading: true, emissive: '#dfeaf5', emissiveIntensity: 0.35 });
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
        const tree = this.makeTree(rand, 0.9);
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

  makeTree(rand, scale = 1) {
    const g = new THREE.Group();
    const kind = rand();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), lambert('#8b5a33', { flatShading: true }));
    trunk.position.y = 0.2;
    trunk.castShadow = true;
    g.add(trunk);
    if (kind < 0.5) {
      const green = ['#3f9b4a', '#358a42', '#4aa957'][Math.floor(rand() * 3)];
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.1, 0.55, 7), lambert(green, { flatShading: true }));
        cone.position.y = 0.45 + i * 0.3;
        cone.castShadow = true;
        g.add(cone);
      }
    } else {
      const green = ['#6cbf4a', '#8fcf52', '#5bb04a', '#f2a0b5'][Math.floor(rand() * 4)];
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), lambert(green, { flatShading: true }));
      crown.position.y = 0.65;
      crown.scale.set(1, 0.9, 1);
      crown.castShadow = true;
      g.add(crown);
    }
    g.scale.setScalar(scale * (0.75 + rand() * 0.6));
    g.rotation.y = rand() * Math.PI * 2;
    return g;
  }

  // ---- A hole ---------------------------------------------------------------

  buildHole(hole, terrain, index) {
    if (this.holeGroup) {
      this.scene.remove(this.holeGroup);
      this.holeGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
    }
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.particles = [];

    this.hole = hole;
    this.terrain = terrain;
    this.winter = hole.theme === 'winter';
    this.pal = PALETTES[this.winter ? 'winter' : 'summer'];
    const g = this.holeGroup = new THREE.Group();
    const b = this.bounds = bounds(hole.shape);
    const island = this.island = makeIsland(b);

    this.buildGround(g, hole, terrain, island);
    this.buildSkirt(g, terrain, island);
    this.buildRails(g, hole, terrain);
    this.buildWater(g, hole, terrain);
    this.buildIce(g, hole, terrain);
    this.buildCup(g, hole, terrain);
    this.buildObstacles(g, hole, terrain);
    this.buildGaps(g, hole, terrain);
    this.buildWindmills(g, hole, terrain);
    this.buildBumpers(g, hole, terrain);
    this.buildPipes(g, hole, terrain);
    this.buildScenery(g, hole, terrain, island, index);
    this.snow = null;
    if (this.winter) this.buildSnow(g);

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
    const zoneColor = { sand: COLORS.sand, ice: COLORS.ice, water: COLORS.pondBed };
    // Holes cut in the fairway: the cup and warp pipe mouths, and gaps.
    const cuts = [[cx, cz, CUP_R], ...(hole.pipes || []).map(p => [p.from[0], p.from[1], PIPE_R])];
    const gaps = hole.gaps || [];
    const inCut = (x, z) => cuts.some(([ux, uz, r]) => Math.hypot(x - ux, z - uz) < r) || gaps.some(gp => z > gp.z1 && z < gp.z2);

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        inPoly[j * nx + i] = insidePolygon(hole.shape, x0 + i * GRID, z0 + j * GRID) ? 1 : 0;
      }
    }
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

        // Rough vertex
        if (!inside || edge) {
          let rx = x, rz = z;
          if (inside) [rx, rz] = nearestOnPolygon(hole.shape, x, z).point;
          else if (!island.inside(x, z)) [rx, rz] = island.snap(x, z);
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
        const tris = [[a, c, b, mx - GRID / 6, mz - GRID / 6], [b, c, d, mx + GRID / 6, mz + GRID / 6]];
        for (const [p, q, r, tx, tz] of tris) {
          const inside = sum === 4 ? true : sum === 0 ? false : insidePolygon(hole.shape, tx, tz);
          if (inside) {
            if (!inCut(tx, tz)) fairIdx.push(p, q, r);
          } else if (island.inside(tx, tz)) {
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
    const fairMat = this.winter
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: '#a9d4ea', emissiveIntensity: 0.22 })
      : lambert('#ffffff', { vertexColors: true });
    g.add(mesh(fairPos, fairCol, fairIdx, fairMat));
    g.add(mesh(roughPos, roughCol, roughIdx, lambert('#ffffff', { vertexColors: true })));
  }

  // The island's crumbly underside.
  buildSkirt(g, terrain, island) {
    const ring = island.outline(0.35);
    const rand = rng(5);
    const cx = (island.x0 + island.x1) / 2, cz = (island.z0 + island.z1) / 2;
    let minH = Infinity;
    const tops = ring.map(([x, z]) => {
      const h = terrain.height(x, z) - ROUGH_DROP;
      minH = Math.min(minH, h);
      return h;
    });
    const layers = [
      { scale: 1, drop: 0, color: this.pal.rough },
      { scale: 1.0, drop: 0.12, color: this.pal.roughDark },
      { scale: 0.97, drop: 0.5, color: COLORS.dirtTop },
      { scale: 0.82, drop: 1.4, color: COLORS.dirt },
      { scale: 0.55, drop: 2.6, color: COLORS.dirt },
      { scale: 0.25, drop: 3.8, color: COLORS.rock },
    ];
    const pos = [], colr = [];
    const n = ring.length;
    const pt = (li, i) => {
      const L = layers[li];
      const [x, z] = ring[i % n];
      const jitter = li > 1 ? (rand() - 0.5) * 0.25 : 0;
      const y = li < 2 ? tops[i % n] - L.drop : minH - L.drop + jitter;
      return [cx + (x - cx) * L.scale + jitter, y, cz + (z - cz) * L.scale + jitter];
    };
    // Precompute so neighbouring quads share jittered points.
    const grid = layers.map((_, li) => ring.map((__, i) => pt(li, i)));
    for (let li = 0; li < layers.length - 1; li++) {
      for (let i = 0; i < n; i++) {
        const a = grid[li][i], b = grid[li][(i + 1) % n];
        const c = grid[li + 1][i], d = grid[li + 1][(i + 1) % n];
        pos.push(...a, ...c, ...b, ...b, ...c, ...d);
        const ca = layers[li].color, cb = layers[li + 1].color;
        for (const cc of [ca, cb, ca, ca, cb, cb]) colr.push(cc.r, cc.g, cc.b);
      }
    }
    const apex = [cx, minH - 5.5, cz];
    const last = layers.length - 1;
    for (let i = 0; i < n; i++) {
      const a = grid[last][i], b = grid[last][(i + 1) % n];
      pos.push(...a, ...apex, ...b);
      for (let k = 0; k < 3; k++) colr.push(COLORS.rock.r, COLORS.rock.g, COLORS.rock.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, lambert('#ffffff', { vertexColors: true, flatShading: true })));
  }

  // Rails follow the ground, so they climb ramps with it.
  buildRails(g, hole, terrain) {
    const segs = [];
    const pts = hole.shape;
    for (let i = 0; i < pts.length; i++) segs.push([...pts[i], ...pts[(i + 1) % pts.length]]);
    for (const w of hole.walls || []) segs.push(w);

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
      posts.push([x1, z1], [x2, z2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.computeVertexNormals();
    const rails = new THREE.Mesh(geo, lambert('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
    rails.castShadow = true;
    rails.receiveShadow = true;
    g.add(rails);

    const postGeo = new THREE.CylinderGeometry(WALL_HALF + 0.03, WALL_HALF + 0.035, 0.42, 10);
    const capGeo = new THREE.SphereGeometry(WALL_HALF + 0.03, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const postMat = lambert(COLORS.post);
    const seen = new Set();
    for (const [x, z] of posts) {
      const key = `${x.toFixed(2)},${z.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const y = h(x, z);
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, y + 0.0, z);
      p.castShadow = true;
      const cap = new THREE.Mesh(capGeo, postMat);
      cap.position.set(x, y + 0.21, z);
      g.add(p, cap);
    }
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
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.38, 14), lambert('#ffd23f'));
      hub.position.y = 0.12;
      hub.castShadow = true;
      const bar = new THREE.Group();
      const segN = 6;
      for (let i = 0; i < segN; i++) {
        const piece = new THREE.Mesh(
          new THREE.BoxGeometry((s.len * 2) / segN, 0.13, 0.14),
          lambert(i % 2 ? '#ffffff' : '#ef476f'),
        );
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
      g.add(block);
      return { m, block };
    });
  }

  // A chasm right across the fairway, with a hazard stripe on each lip.
  buildGaps(g, hole, terrain) {
    const { x0, x1 } = this.bounds;
    const dark = lambert('#4a3526', { side: THREE.DoubleSide });
    const deep = lambert('#1d1611');
    for (const gp of hole.gaps || []) {
      const w = x1 - x0, mid = (x0 + x1) / 2, depth = 1.6;
      for (const z of [gp.z1, gp.z2]) {
        const y = terrain.height(mid, z);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), dark);
        face.position.set(mid, y - depth / 2, z);
        g.add(face);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.02, 0.08), lambert('#ffd23f'));
        stripe.position.set(mid, y + 0.005, z + (z === gp.z1 ? -0.04 : 0.04));
        g.add(stripe);
      }
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
    this.bumpers = (hole.bumpers || []).map(bp => {
      const grp = new THREE.Group();
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
    if (this.winter) {
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
      const y = terrain.height(x, z) - ROUGH_DROP;
      let obj;
      const r = rand();
      // Keep tall things away from the rails so they don't block the view.
      if (edge > 1.1 && r < 0.55) obj = this.winter ? this.makeSnowyPine(rand) : this.makeTree(rand);
      else if (r < 0.8) obj = this.winter ? this.makeSnowdrift(rand) : this.makeBush(rand);
      else obj = this.makeRock(rand);
      obj.position.set(x, y, z);
      g.add(obj);
    }
    if (this.winter) return;
    // A few flowers dotted around the rough.
    const petals = ['#ffffff', '#ffd23f', '#ff8fab', '#b39cff'];
    const flowerGeo = new THREE.IcosahedronGeometry(0.04, 0);
    for (let i = 0; i < 70; i++) {
      const x = island.x0 + rand() * (island.x1 - island.x0);
      const z = island.z0 + rand() * (island.z1 - island.z0);
      if (!island.inside(x, z, 0.15) || insidePolygon(hole.shape, x, z)) continue;
      if (nearestOnPolygon(hole.shape, x, z).dist < 0.2) continue;
      const f = new THREE.Mesh(flowerGeo, lambert(petals[Math.floor(rand() * petals.length)]));
      f.position.set(x, terrain.height(x, z) - ROUGH_DROP + 0.03, z);
      g.add(f);
    }
  }

  makeSnowyPine(rand) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), lambert('#6e4a2c', { flatShading: true }));
    trunk.position.y = 0.2;
    g.add(trunk);
    const green = lambert(['#2f6b45', '#2a5e3d', '#3a7a50'][Math.floor(rand() * 3)], { flatShading: true });
    const snow = lambert('#f7fbff', { flatShading: true });
    for (let i = 0; i < 3; i++) {
      const r = 0.42 - i * 0.1;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 0.55, 7), green);
      cone.position.y = 0.45 + i * 0.3;
      cone.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, 0.3, 7), snow);
      cap.position.y = 0.59 + i * 0.3;
      g.add(cone, cap);
    }
    g.scale.setScalar(0.75 + rand() * 0.6);
    g.rotation.y = rand() * Math.PI * 2;
    return g;
  }

  makeSnowdrift(rand) {
    const g = new THREE.Group();
    const mat = lambert('#f3f8fc', { flatShading: true });
    for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2 + rand() * 0.1, 0), mat);
      m.position.set((rand() - 0.5) * 0.35, 0.05, (rand() - 0.5) * 0.35);
      m.scale.y = 0.55;
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  // Snowflakes drifting down over a winter island.
  buildSnow(g) {
    const isl = this.island, N = 450;
    const pos = new Float32Array(N * 3);
    const rand = rng(31);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = isl.x0 - 2 + rand() * (isl.x1 - isl.x0 + 4);
      pos[i * 3 + 1] = -1 + rand() * 7;
      pos[i * 3 + 2] = isl.z0 - 2 + rand() * (isl.z1 - isl.z0 + 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Round, soft-edged flakes rather than square points.
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    const flake = new THREE.CanvasTexture(c);
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({
      map: flake, size: 0.07, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    g.add(this.snow);
  }

  makeBush(rand) {
    const g = new THREE.Group();
    const mat = lambert(['#4fa64a', '#5db84f', '#3f9845'][Math.floor(rand() * 3)], { flatShading: true });
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2 + rand() * 0.1, 0), mat);
      m.position.set((rand() - 0.5) * 0.35, 0.12, (rand() - 0.5) * 0.35);
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  makeRock(rand) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rand() * 0.14, 0), lambert('#9aa0a6', { flatShading: true }));
    m.scale.y = 0.6;
    m.rotation.set(rand(), rand() * 3, rand());
    m.castShadow = true;
    const g = new THREE.Group();
    m.position.y = 0.05;
    g.add(m);
    return g;
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

    if (this.snow && !reduceMotion) {
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - dt * (0.35 + (i % 5) * 0.06);
        if (y < -1) y += 7;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(this.time * 0.8 + i) * dt * 0.08);
      }
      p.needsUpdate = true;
    }

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
