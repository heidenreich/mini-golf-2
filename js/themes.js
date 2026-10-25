import * as THREE from '../vendor/three.module.min.js';
import { insidePolygon } from './terrain.js';

// The look of each island. Themes only change what you see; the ground's
// surface (and so how the ball rolls) comes from the hole's data.
//
// Each theme has:
//   ground    colours for the fairway stripes, rough, cup surround and the
//             island's underside, plus `glossy` for a shiny fairway
//   sky       gradient colours, fog colour and the lights
//   chasm     colours for the walls and floor of a gap
//   edge      what hangs off the island's edge: vines, roots, icicles,
//             crystals or lava
//   bumperStyle / spinnerStyle   restyle those obstacles (mushroom, puff, crystal)
//   cloudy    the island is a cloud: puffy rails and a cloud underneath
//   waterfall true for streams pouring off each side
//   scenery   (api, rand, roomy) => an Object3D for a spot in the rough;
//             roomy is true well away from the rails, where tall things fit
//   flora     how many small ground details to scatter, and how to make one
//   drift     particles in the air: snow, leaves, embers, fireflies...
//   extras    (api) => optional per-frame update(dt, time): the theme's
//             signature pieces (ducks, tulip fields, lava, stars)
//   night     dark sky: rails, posts, pipes and the ball glow, and holing
//             out sets off fireworks

// ---- Shared helpers ---------------------------------------------------------

// Small deterministic random numbers, so each hole's scenery is the same
// every time you play it.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

const C = c => new THREE.Color(c);
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

function mesh(geo, mat, { x = 0, y = 0, z = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

function finish(g, rand, scale = 1) {
  g.scale.setScalar(scale * (0.75 + rand() * 0.6));
  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// ---- Trees and things ----------------------------------------------------------

export function makeTree(rand, scale = 1, greens) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), lambert('#8b5a33', { flatShading: true }), { y: 0.2 }));
  if (!greens && rand() < 0.5) {
    const mat = lambert(pick(rand, ['#3f9b4a', '#358a42', '#4aa957']), { flatShading: true });
    for (let i = 0; i < 3; i++) {
      g.add(mesh(new THREE.ConeGeometry(0.42 - i * 0.1, 0.55, 7), mat, { y: 0.45 + i * 0.3 }));
    }
  } else {
    const mat = lambert(pick(rand, greens || ['#6cbf4a', '#8fcf52', '#5bb04a', '#f2a0b5']), { flatShading: true });
    const crown = mesh(new THREE.IcosahedronGeometry(0.42, 0), mat, { y: 0.65 });
    crown.scale.set(1, 0.9, 1);
    g.add(crown);
  }
  return finish(g, rand, scale);
}

function makeBush(rand, colors = ['#4fa64a', '#5db84f', '#3f9845']) {
  const g = new THREE.Group();
  const mat = lambert(pick(rand, colors), { flatShading: true });
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    g.add(mesh(new THREE.IcosahedronGeometry(0.2 + rand() * 0.1, 0), mat, { x: (rand() - 0.5) * 0.35, y: 0.12, z: (rand() - 0.5) * 0.35 }));
  }
  return g;
}

function makeRock(rand, color = '#9aa0a6', cap) {
  const g = new THREE.Group();
  const m = mesh(new THREE.DodecahedronGeometry(0.16 + rand() * 0.14, 0), lambert(color, { flatShading: true }), { y: 0.05 });
  m.scale.y = 0.6;
  m.rotation.set(rand(), rand() * 3, rand());
  g.add(m);
  if (cap) {
    const c = mesh(new THREE.DodecahedronGeometry(0.12, 0), lambert(cap, { flatShading: true }), { y: 0.13 });
    c.scale.y = 0.35;
    g.add(c);
  }
  return g;
}

function makeSnowyPine(rand) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), lambert('#6e4a2c', { flatShading: true }), { y: 0.2 }));
  const green = lambert(pick(rand, ['#2f6b45', '#2a5e3d', '#3a7a50']), { flatShading: true });
  const snow = lambert('#f7fbff', { flatShading: true });
  for (let i = 0; i < 3; i++) {
    const r = 0.42 - i * 0.1;
    g.add(mesh(new THREE.ConeGeometry(r, 0.55, 7), green, { y: 0.45 + i * 0.3 }));
    g.add(mesh(new THREE.ConeGeometry(r * 0.62, 0.3, 7), snow, { y: 0.59 + i * 0.3, shadow: false }));
  }
  return finish(g, rand);
}

function makeMound(rand, color) {
  const g = new THREE.Group();
  const mat = lambert(color, { flatShading: true });
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const m = mesh(new THREE.IcosahedronGeometry(0.2 + rand() * 0.1, 0), mat, { x: (rand() - 0.5) * 0.35, y: 0.05, z: (rand() - 0.5) * 0.35 });
    m.scale.y = 0.55;
    g.add(m);
  }
  return g;
}

function makeCactus(rand) {
  const g = new THREE.Group();
  const mat = lambert(pick(rand, ['#4f8a3c', '#5c9a45', '#457a35']), { flatShading: true });
  const h = 0.7 + rand() * 0.5;
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.1, h, 8), mat, { y: h / 2 }));
  g.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), mat, { y: h }));
  for (const side of [-1, 1]) {
    if (rand() < 0.3) continue;
    const y = h * (0.35 + rand() * 0.3), up = 0.2 + rand() * 0.2;
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), mat, { x: side * 0.14, y, z: 0 }).rotateZ(Math.PI / 2));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, up, 6), mat, { x: side * 0.22, y: y + up / 2, z: 0 }));
  }
  return finish(g, rand, 0.9);
}

function makeMesa(rand) {
  const g = new THREE.Group();
  const h = 0.5 + rand() * 0.7;
  const m = mesh(new THREE.CylinderGeometry(0.25 + rand() * 0.15, 0.35 + rand() * 0.15, h, 7), lambert(pick(rand, ['#c4673a', '#b55a32', '#d27a48']), { flatShading: true }), { y: h / 2 });
  g.add(m);
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 7), lambert('#e09a68', { flatShading: true }), { y: h * 0.62, shadow: false }));
  return finish(g, rand);
}

function makePalm(rand) {
  const g = new THREE.Group();
  const trunkMat = lambert('#a77b4f', { flatShading: true });
  const lean = (rand() - 0.5) * 0.5;
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) {
    const seg = mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.24, 6), trunkMat, { x, y: y + 0.12 });
    seg.rotation.z = -lean * 0.4;
    g.add(seg);
    x += lean * 0.05 * i;
    y += 0.22;
  }
  const leaf = lambert(pick(rand, ['#3f9b4a', '#4aa957', '#358a42']), { flatShading: true, side: THREE.DoubleSide });
  for (let k = 0; k < 6; k++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 4), leaf);
    frond.castShadow = true;
    frond.position.set(x, y, 0);
    frond.rotation.set(0, (k / 6) * Math.PI * 2, 0);
    frond.rotateZ(Math.PI / 2 + 0.35);
    frond.translateY(-0.3);
    g.add(frond);
  }
  g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), lambert('#6b4a2a'), { x, y: y - 0.04 }));
  return finish(g, rand);
}

function makeBareTree(rand) {
  const g = new THREE.Group();
  const mat = lambert('#2b2420', { flatShading: true });
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.8, 5), mat, { y: 0.4 }));
  for (let i = 0; i < 3; i++) {
    const b = mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.4, 4), mat, { y: 0.5 + i * 0.12 });
    b.rotation.z = (rand() - 0.5) * 1.6;
    b.rotation.y = rand() * 6;
    g.add(b);
  }
  return finish(g, rand);
}

function makeReeds(rand) {
  const g = new THREE.Group();
  const stalk = lambert('#5d8f3a');
  const head = lambert('#6b4428');
  for (let i = 0; i < 5; i++) {
    const h = 0.35 + rand() * 0.25, x = (rand() - 0.5) * 0.25, z = (rand() - 0.5) * 0.25;
    const s = mesh(new THREE.CylinderGeometry(0.012, 0.015, h, 4), stalk, { x, y: h / 2, z, shadow: false });
    s.rotation.z = (rand() - 0.5) * 0.25;
    g.add(s, mesh(new THREE.CapsuleGeometry(0.025, 0.08, 2, 6), head, { x, y: h, z, shadow: false }));
  }
  return g;
}

function makeUmbrella(rand) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), lambert('#f4f4f4'), { y: 0.4 }));
  const colors = pick(rand, [['#ef476f', '#ffffff'], ['#118ab2', '#ffffff'], ['#ffd23f', '#06d6a0']]);
  for (let k = 0; k < 8; k++) {
    const seg = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.18, 8, 1, true, (k / 8) * Math.PI * 2, Math.PI / 4), lambert(colors[k % 2], { side: THREE.DoubleSide }));
    seg.position.y = 0.82;
    seg.castShadow = true;
    g.add(seg);
  }
  g.rotation.z = (rand() - 0.5) * 0.3;
  return g;
}

function makeMushroom(rand, scale = 1) {
  const g = new THREE.Group();
  const h = 0.4 + rand() * 0.5, r = 0.25 + rand() * 0.25;
  g.add(mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.35, h, 8), lambert('#f4ead8'), { y: h / 2 }));
  const capColor = pick(rand, ['#e63946', '#8e5ad6', '#2ec4b6', '#ff8c42']);
  const cap = mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert(capColor), { y: h - 0.02 });
  cap.scale.y = 0.7;
  g.add(cap);
  const spot = lambert('#ffffff');
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2, e = 0.25 + rand() * 0.9;
    g.add(mesh(new THREE.SphereGeometry(r * 0.12, 6, 4), spot, { x: Math.cos(a) * Math.cos(e) * r, y: h - 0.02 + Math.sin(e) * r * 0.7, z: Math.sin(a) * Math.cos(e) * r, shadow: false }));
  }
  return finish(g, rand, scale);
}

function makeCherryTree(rand) {
  const g = new THREE.Group();
  const trunk = lambert('#5a3a2a', { flatShading: true });
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6), trunk, { y: 0.3 }));
  const pinks = ['#ffb7d5', '#ff9cc4', '#ffc8dd', '#ffffff'];
  for (let i = 0; i < 4; i++) {
    const c = mesh(new THREE.IcosahedronGeometry(0.22 + rand() * 0.12, 0), lambert(pick(rand, pinks), { flatShading: true }), {
      x: (rand() - 0.5) * 0.45, y: 0.65 + rand() * 0.3, z: (rand() - 0.5) * 0.45,
    });
    g.add(c);
  }
  return finish(g, rand);
}

function makeLantern(rand) {
  const g = new THREE.Group();
  const stone = lambert('#a8a49c', { flatShading: true });
  g.add(mesh(new THREE.BoxGeometry(0.18, 0.06, 0.18), stone, { y: 0.03 }));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 6), stone, { y: 0.18 }));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), lambert('#fff3c4', { emissive: '#ffcf6b', emissiveIntensity: 0.6 }), { y: 0.36 }));
  g.add(mesh(new THREE.ConeGeometry(0.17, 0.12, 4), stone, { y: 0.48 }).rotateY(Math.PI / 4));
  g.rotation.y = rand() * 6;
  return g;
}

export const CRYSTAL_COLORS = ['#b388ff', '#64dfdf', '#ff7ac6', '#7aa2ff'];

function makeCrystals(rand, scale = 1) {
  const g = new THREE.Group();
  const color = pick(rand, CRYSTAL_COLORS);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.1, flatShading: true });
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.25 + rand() * 0.55;
    const c = mesh(new THREE.OctahedronGeometry(0.1 + rand() * 0.06, 0), mat, { x: (rand() - 0.5) * 0.3, y: h * 0.5, z: (rand() - 0.5) * 0.3 });
    c.scale.set(1, h / 0.15, 1);
    c.rotation.set((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6);
    g.add(c);
  }
  return finish(g, rand, scale);
}

function makePuff(rand) {
  const g = new THREE.Group();
  const mat = lambert('#ffffff', { flatShading: true, emissive: '#eef4fb', emissiveIntensity: 0.4 });
  for (let i = 0; i < 3; i++) {
    const m = mesh(new THREE.IcosahedronGeometry(0.18 + rand() * 0.12, 1), mat, { x: (i - 1) * 0.22, y: 0.12 + rand() * 0.08, z: (rand() - 0.5) * 0.2 });
    m.scale.y = 0.75;
    g.add(m);
  }
  return g;
}

// ---- Small ground details ----------------------------------------------------------

const dot = (r = 0.04) => new THREE.IcosahedronGeometry(r, 0);

function makeFlower(rand, colors) {
  return mesh(dot(), lambert(pick(rand, colors)), { y: 0.03, shadow: false });
}

function makeLeaf(rand) {
  const m = mesh(new THREE.CircleGeometry(0.05, 5), lambert(pick(rand, ['#e8742c', '#d9452b', '#f2b33d', '#b5651d']), { side: THREE.DoubleSide }), { y: 0.015, shadow: false });
  m.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.4, 0, rand() * 6);
  return m;
}

function makeShell(rand) {
  const m = mesh(new THREE.SphereGeometry(0.035, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), lambert(pick(rand, ['#fff1e6', '#ffd1dc', '#f7e1b5'])), { y: 0.01, shadow: false });
  m.scale.set(1, 0.5, 1.3);
  m.rotation.y = rand() * 6;
  return m;
}

// ---- Particles in the air -------------------------------------------------------------

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// kind: 'fall' drifts down (snow, leaves, petals), 'rise' floats up
// (embers), 'hover' bobs about a fixed spot (fireflies, butterflies).
export function makeDrift(island, d) {
  const rand = rng(31);
  const N = d.count;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), base = new Float32Array(N * 3);
  const colors = d.colors.map(C);
  const lo = d.kind === 'hover' ? 0.15 : -1, span = d.kind === 'hover' ? 1.4 : 7;
  for (let i = 0; i < N; i++) {
    const x = island.x0 - 1 + rand() * (island.x1 - island.x0 + 2);
    const z = island.z0 - 1 + rand() * (island.z1 - island.z0 + 2);
    const y = lo + rand() * span;
    base.set([x, y, z], i * 3);
    pos.set([x, y, z], i * 3);
    const c = colors[i % colors.length];
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: softDot(), size: d.size, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, blending: d.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  points.frustumCulled = false;
  const update = (dt, time) => {
    const p = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      if (d.kind === 'hover') {
        p.setXYZ(i,
          base[i * 3] + Math.sin(time * 0.7 + i * 1.7) * 0.4,
          base[i * 3 + 1] + Math.sin(time * 1.3 + i) * 0.15,
          base[i * 3 + 2] + Math.cos(time * 0.6 + i * 2.3) * 0.4);
        continue;
      }
      const v = d.speed * (0.8 + (i % 5) * 0.1);
      let y = p.getY(i) + (d.kind === 'rise' ? v : -v) * dt;
      if (y < -1) y += 7;
      if (y > 6) y -= 7;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(time * 0.8 + i) * dt * (d.sway || 0.08));
    }
    p.needsUpdate = true;
  };
  return { points, update };
}

// ---- Signature pieces ------------------------------------------------------------------

// Lily pads and a few ducks paddling slow loops round each pond.
function pondLife(api) {
  const { group, waters } = api;
  const rand = rng(404);
  const ducks = [];
  const pad = lambert('#4d9a3a', { side: THREE.DoubleSide });
  const bloom = lambert('#ff9cc0');
  for (const w of waters) {
    const { zone, level } = w;
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.8;
      const x = zone.x + Math.cos(a) * r * zone.w / 2, z = zone.z + Math.sin(a) * r * zone.d / 2;
      const p = mesh(new THREE.CircleGeometry(0.12 + rand() * 0.08, 10, 0.3, Math.PI * 2 - 0.6), pad, { x, y: level + 0.01, z, shadow: false });
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = rand() * 6;
      group.add(p);
      if (rand() < 0.35) group.add(mesh(dot(0.04), bloom, { x, y: level + 0.04, z, shadow: false }));
    }
    for (let k = 0; k < 2; k++) {
      const duck = new THREE.Group();
      const white = lambert(k ? '#ffffff' : '#ffe066', { flatShading: true });
      const body = mesh(new THREE.SphereGeometry(0.09, 10, 8), white, { y: 0.03 });
      body.scale.set(0.8, 0.7, 1.3);
      const head = mesh(new THREE.SphereGeometry(0.055, 10, 8), white, { y: 0.12, z: 0.09 });
      const beak = mesh(new THREE.ConeGeometry(0.025, 0.06, 6), lambert('#ff8c1a'), { y: 0.11, z: 0.155 });
      beak.rotation.x = Math.PI / 2;
      duck.add(body, head, beak);
      duck.position.y = level;
      group.add(duck);
      ducks.push({ duck, zone, phase: rand() * 6, speed: (0.15 + rand() * 0.1) * (k ? 1 : -1) });
    }
  }
  return (dt, time) => {
    for (const d of ducks) {
      const a = d.phase + time * d.speed;
      d.duck.position.x = d.zone.x + Math.cos(a) * d.zone.w * 0.27;
      d.duck.position.z = d.zone.z + Math.sin(a) * d.zone.d * 0.27;
      // Face along the loop (the beak is on the duck's +z).
      const sgn = Math.sign(d.speed);
      d.duck.rotation.y = Math.atan2(-Math.sin(a) * d.zone.w * sgn, Math.cos(a) * d.zone.d * sgn);
      d.duck.rotation.z = Math.sin(time * 3 + d.phase) * 0.05;
    }
  };
}

// Stripes of tulips filling the rough, Dutch-field style.
function tulipFields(api) {
  const { group, island, hole, terrain, nearRail } = api;
  const spots = [];
  for (let x = island.x0 + 0.2; x < island.x1 - 0.2; x += 0.2) {
    for (let z = island.z0 + 0.2; z < island.z1 - 0.2; z += 0.16) {
      if (!island.inside(x, z, 0.25) || insidePolygon(hole.shape, x, z) || nearRail(x, z) < 0.3) continue;
      spots.push([x, z, Math.floor((x - island.x0) / 0.6)]);
    }
  }
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), lambert('#3f8f3a'), spots.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 7, 5), lambert('#ffffff'), spots.length);
  const colors = ['#ef233c', '#ffd23f', '#ff7aa2', '#ff8c1a', '#b388ff'].map(C);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, band], i) => {
    const y = terrain.height(x, z) - 0.05;
    m.makeTranslation(x, y + 0.08, z);
    stems.setMatrixAt(i, m);
    m.makeScale(1, 1.25, 1).setPosition(x, y + 0.18, z);
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, colors[band % colors.length]);
  });
  group.add(stems, heads);
}

// Glowing cracks of lava across the black rock.
function lavaCracks(api) {
  const { group, island, hole, terrain, nearRail } = api;
  const rand = rng(666);
  const mat = new THREE.MeshBasicMaterial({ color: '#ff6a1a' });
  const pieces = new THREE.Group();
  for (let c = 0; c < 22; c++) {
    let x = island.x0 + rand() * (island.x1 - island.x0), z = island.z0 + rand() * (island.z1 - island.z0);
    let a = rand() * Math.PI * 2;
    for (let s = 0; s < 6; s++) {
      const len = 0.25 + rand() * 0.3;
      const nx = x + Math.cos(a) * len, nz = z + Math.sin(a) * len;
      const mx = (x + nx) / 2, mz = (z + nz) / 2;
      if (island.inside(mx, mz, 0.2) && !insidePolygon(hole.shape, mx, mz) && nearRail(mx, mz) > 0.25) {
        const seg = mesh(new THREE.BoxGeometry(len, 0.012, 0.035), mat, { x: mx, y: terrain.height(mx, mz) - 0.04, z: mz, shadow: false });
        seg.rotation.y = -a;
        pieces.add(seg);
      }
      x = nx; z = nz;
      a += (rand() - 0.5) * 1.2;
    }
  }
  group.add(pieces);
  return (dt, time) => {
    const k = 0.75 + 0.25 * Math.sin(time * 2.2);
    mat.color.setRGB(1, 0.32 + 0.15 * k, 0.08);
  };
}

// A dome of stars.
function starField(api) {
  const rand = rng(9);
  const N = 500;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = rand() * Math.PI * 2, e = Math.asin(0.05 + rand() * 0.95), r = 90;
    pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r - 10, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false, transparent: true }));
  stars.position.set(api.bounds.cx, 0, api.bounds.cz);
  stars.frustumCulled = false;
  api.group.add(stars);
  return (dt, time) => { stars.material.opacity = 0.75 + 0.25 * Math.sin(time * 1.3); };
}

// ---- The themes -------------------------------------------------------------------------

const SUMMER_SKY = { top: '#5fb3ec', bottom: '#d9f0ff', fog: '#d9f0ff', hemi: ['#e4f3ff', '#5f8a3e', 0.95], sun: ['#fff6e0', 2.7] };
const DIRT = { dirtTop: C('#9a6a42'), dirt: C('#7d5536'), rock: C('#7b7f86') };
const GRASS = { grassA: C('#79c94f'), grassB: C('#6bbb45'), green: C('#86d35b') };
const CHASM = { wall: '#4a3526', floor: '#1d1611' };

export const THEMES = {
  meadow: {
    name: 'Spring meadow',
    edge: 'vines',
    waterfall: true,
    ground: { ...GRASS, rough: C('#5aa63c'), roughDark: C('#4c9434'), ...DIRT },
    sky: SUMMER_SKY,
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.55 ? makeTree(rand) : rand() < 0.75 ? makeBush(rand) : makeRock(rand)),
    flora: { count: 70, make: rand => makeFlower(rand, ['#ffffff', '#ffd23f', '#ff8fab', '#b39cff']) },
    drift: { kind: 'hover', count: 14, colors: ['#ffd23f', '#ff8fab', '#ffffff', '#8fd3ff'], size: 0.09 },
  },

  desert: {
    name: 'Desert canyon',
    edge: 'roots',
    ground: {
      grassA: C('#8cc152'), grassB: C('#7fb548'), green: C('#9bd15c'),
      rough: C('#e0b27a'), roughDark: C('#cf9a5e'),
      dirtTop: C('#c8693a'), dirt: C('#a9532c'), rock: C('#7e3c22'),
    },
    sky: { top: '#5aaee8', bottom: '#ffe3bd', fog: '#f6dcbc', hemi: ['#fff1dc', '#b07a46', 0.95], sun: ['#ffe2b0', 2.9] },
    chasm: { wall: '#9a4a2a', floor: '#3a1a10' },
    scenery: (api, rand, roomy) => (roomy && rand() < 0.45 ? makeCactus(rand) : roomy && rand() < 0.4 ? makeMesa(rand) : makeRock(rand, '#b5653a')),
    flora: { count: 60, make: rand => mesh(dot(0.03), lambert(pick(rand, ['#c9844f', '#e8c28f', '#8a5a3a']), { flatShading: true }), { y: 0.01, shadow: false }) },
    drift: { kind: 'hover', count: 18, colors: ['#f5d7a8'], size: 0.05 },
  },

  autumn: {
    name: 'Autumn forest',
    edge: 'roots',
    waterfall: true,
    ground: {
      grassA: C('#9cc25a'), grassB: C('#8fb54f'), green: C('#a9cf63'),
      rough: C('#8e9440'), roughDark: C('#7a7e34'), ...DIRT,
    },
    sky: { top: '#6ab0e0', bottom: '#ffe9c9', fog: '#f4e3c8', hemi: ['#fff0d8', '#8a6a2e', 0.95], sun: ['#ffd9a0', 2.7] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.65
      ? (rand() < 0.25 ? makeTree(rand, 1, ['#2f6b45']) : makeTree(rand, 1, ['#e8742c', '#d9452b', '#f2b33d', '#c0392b']))
      : rand() < 0.7 ? makeBush(rand, ['#c96a2b', '#b5651d', '#d9a23a']) : makeRock(rand)),
    flora: { count: 140, make: makeLeaf },
    drift: { kind: 'fall', count: 70, colors: ['#e8742c', '#d9452b', '#f2b33d'], size: 0.09, speed: 0.45, sway: 0.4 },
  },

  pond: {
    name: 'Lily pond',
    edge: 'vines',
    waterfall: true,
    ground: { ...GRASS, rough: C('#4fa23a'), roughDark: C('#3f8f30'), ...DIRT },
    sky: SUMMER_SKY,
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.5 ? makeTree(rand, 1, ['#5bb04a', '#6cbf4a', '#4aa957']) : rand() < 0.6 ? makeReeds(rand) : makeBush(rand)),
    flora: { count: 50, make: rand => makeFlower(rand, ['#ffffff', '#ffd23f']) },
    drift: { kind: 'hover', count: 10, colors: ['#4cc9f0', '#80ffdb'], size: 0.08 },
    extras: pondLife,
  },

  tulips: {
    name: 'Tulip fields',
    edge: 'vines',
    ground: { ...GRASS, rough: C('#5fae3e'), roughDark: C('#529e35'), ...DIRT },
    sky: SUMMER_SKY,
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.25 ? makeTree(rand, 0.9, ['#6cbf4a', '#8fcf52']) : null),
    flora: { count: 0 },
    drift: { kind: 'fall', count: 30, colors: ['#ff7aa2', '#ffd23f', '#ef233c'], size: 0.06, speed: 0.3, sway: 0.5 },
    extras: tulipFields,
  },

  volcano: {
    name: 'Volcanic island',
    edge: 'lava',
    ground: {
      grassA: C('#6fae47'), grassB: C('#62a03f'), green: C('#7cbf52'),
      rough: C('#3b3533'), roughDark: C('#2b2624'),
      dirtTop: C('#3a2a24'), dirt: C('#2a1f1b'), rock: C('#a3361a'),
    },
    sky: { top: '#5f86b0', bottom: '#f2c4a0', fog: '#e8b898', hemi: ['#ffe2cc', '#5a2a1a', 0.9], sun: ['#ffcf9a', 2.6] },
    chasm: { wall: '#2a1f1b', floor: '#ff5a14' },
    scenery: (api, rand, roomy) => (roomy && rand() < 0.35 ? makeBareTree(rand) : makeRock(rand, pick(rand, ['#3d3836', '#4a4340', '#2e2a28']))),
    flora: { count: 0 },
    drift: { kind: 'rise', count: 60, colors: ['#ff8c1a', '#ffb347', '#ff5a14'], size: 0.06, speed: 0.5, sway: 0.25, glow: true },
    extras: lavaCracks,
  },

  beach: {
    name: 'Tropical beach',
    edge: 'vines',
    waterfall: true,
    ground: {
      ...GRASS, rough: C('#f0dca4'), roughDark: C('#e3c98c'),
      dirtTop: C('#e3c98c'), dirt: C('#b89a6a'), rock: C('#8a7f72'),
    },
    sky: { top: '#3fa9e8', bottom: '#d6f3ff', fog: '#d6f3ff', hemi: ['#e8f7ff', '#c9b07a', 1.0], sun: ['#fff6e0', 2.8] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.55 ? makePalm(rand) : roomy && rand() < 0.2 ? makeUmbrella(rand) : rand() < 0.5 ? makeRock(rand, '#b8ad9e') : makeBush(rand, ['#5bb04a', '#4aa957'])),
    flora: { count: 60, make: makeShell },
    drift: null,
  },

  winter: {
    name: 'Frozen island',
    edge: 'icicles',
    ground: {
      grassA: C('#e4f4fc'), grassB: C('#d2eaf7'), green: C('#ffffff'),
      rough: C('#f5f9fc'), roughDark: C('#dde7ef'), ...DIRT, glossy: true, sparkle: true,
    },
    sky: { top: '#7fb8e6', bottom: '#eef6fc', fog: '#eef6fc', hemi: ['#eef6ff', '#a9bccb', 1.0], sun: ['#f4f8ff', 2.5] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.55 ? makeSnowyPine(rand) : rand() < 0.75 ? makeMound(rand, '#f3f8fc') : makeRock(rand, '#9aa0a6', '#f7fbff')),
    flora: { count: 0 },
    drift: { kind: 'fall', count: 450, colors: ['#ffffff'], size: 0.07, speed: 0.4, sway: 0.08 },
  },

  mushroom: {
    name: 'Mushroom grove',
    edge: 'vines',
    bumperStyle: 'mushroom',
    ground: {
      grassA: C('#74c48a'), grassB: C('#67b77d'), green: C('#8fd6a0'),
      rough: C('#4f9e72'), roughDark: C('#428c62'),
      dirtTop: C('#7a5a6e'), dirt: C('#5e4357'), rock: C('#6c6a8a'),
    },
    sky: { top: '#7f73c9', bottom: '#f3dcff', fog: '#e9d6fa', hemi: ['#f3e8ff', '#4f6e5a', 0.95], sun: ['#fff0f6', 2.5] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.7 ? makeMushroom(rand, 1.4) : rand() < 0.6 ? makeMushroom(rand, 0.6) : makeBush(rand, ['#3f8a5c', '#4f9e72'])),
    flora: { count: 60, make: rand => makeMushroom(rand, 0.18) },
    drift: { kind: 'hover', count: 40, colors: ['#9ff6ff', '#d4b3ff'], size: 0.07, glow: true },
  },

  blossom: {
    name: 'Cherry blossom',
    edge: 'roots',
    waterfall: true,
    ground: { ...GRASS, rough: C('#7cc46a'), roughDark: C('#6cb35b'), ...DIRT },
    sky: { top: '#7cb7ea', bottom: '#ffe1ee', fog: '#fbe3ee', hemi: ['#fff0f6', '#6a8f5a', 1.0], sun: ['#fff4ea', 2.6] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.7 ? makeCherryTree(rand) : rand() < 0.4 ? makeLantern(rand) : makeBush(rand, ['#5db84f', '#6cbf4a'])),
    flora: { count: 120, make: rand => makeFlower(rand, ['#ffb7d5', '#ffc8dd', '#ffffff']) },
    drift: { kind: 'fall', count: 60, colors: ['#ffb7d5', '#ffc8dd', '#ffffff'], size: 0.07, speed: 0.35, sway: 0.5 },
  },

  crystal: {
    name: 'Crystal caves',
    edge: 'crystals',
    spinnerStyle: 'crystal',
    ground: {
      grassA: C('#5aa88a'), grassB: C('#4e9b7e'), green: C('#6dbf9e'),
      rough: C('#3c4258'), roughDark: C('#30354a'),
      dirtTop: C('#3a3550'), dirt: C('#2c2840'), rock: C('#5a3f8a'),
    },
    sky: { top: '#1c2556', bottom: '#8a6cc4', fog: '#5e4c92', hemi: ['#c9b8ff', '#2a2a44', 0.85], sun: ['#e6dcff', 2.0] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.6 ? makeCrystals(rand, 1.6) : rand() < 0.6 ? makeCrystals(rand, 0.8) : makeRock(rand, '#4a4f66')),
    flora: { count: 50, make: rand => makeCrystals(rand, 0.25) },
    drift: { kind: 'hover', count: 45, colors: ['#e0c3ff', '#9ff6ff', '#ffc2f0'], size: 0.06, glow: true },
  },

  cloud: {
    name: 'Cloud island',
    edge: null,
    cloudy: true,
    bumperStyle: 'puff',
    ground: {
      grassA: C('#eef6ff'), grassB: C('#e1ecfa'), green: C('#ffffff'),
      rough: C('#ffffff'), roughDark: C('#eef3f9'),
      dirtTop: C('#f4f7fb'), dirt: C('#e6edf6'), rock: C('#d3dcea'),
    },
    sky: { top: '#93c4ef', bottom: '#ffe3f1', fog: '#fbe6f2', hemi: ['#ffffff', '#c9d6ea', 1.15], sun: ['#fff8ee', 2.3] },
    chasm: CHASM,
    scenery: (api, rand) => makePuff(rand),
    flora: { count: 0 },
    drift: { kind: 'hover', count: 40, colors: ['#ffe27a', '#ffffff'], size: 0.06, glow: true },
  },

  night: {
    name: 'Night',
    edge: 'vines',
    night: true,
    ground: { ...GRASS, rough: C('#3f8a3a'), roughDark: C('#33772f'), ...DIRT },
    sky: { top: '#070b26', bottom: '#28356e', fog: '#1d2652', hemi: ['#8fa6ff', '#1d2b3a', 0.75], sun: ['#c9d6ff', 1.5] },
    chasm: CHASM,
    scenery: (api, rand, roomy) => (roomy && rand() < 0.55 ? makeTree(rand) : rand() < 0.75 ? makeBush(rand) : makeRock(rand)),
    flora: { count: 40, make: rand => makeFlower(rand, ['#b39cff', '#8fd3ff']) },
    drift: { kind: 'hover', count: 40, colors: ['#fff27a', '#d4ff6a'], size: 0.08, glow: true },
    extras: starField,
  },
};

export function skyTexture(sky) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, sky.top);
  grad.addColorStop(0.65, sky.bottom);
  grad.addColorStop(1, sky.horizon || sky.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
