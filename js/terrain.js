// Ground height for a hole. Physics and rendering share this, so what you
// see is what the ball rolls on.

const CUP_FLAT_IN = 0.32;   // fully flat this close to the cup
const CUP_FLAT_OUT = 0.7;   // blends back into the hole's shape by here
const SAND_DIP = 0.04;
const WATER_DIP = 0.24;     // drawn only: the ball splashes before it would feel it

export const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function bump(d, h) {
  return d >= 1 ? 0 : h * 0.5 * (1 + Math.cos(Math.PI * d));
}

function featureHeight(f, x, z) {
  switch (f.type) {
    case 'tilt':
      return (f.gx || 0) * x + (f.gz || 0) * z;
    case 'ramp': {
      const c = f.axis === 'x' ? x : z;
      return f.rise * smooth((c - f.from) / (f.to - f.from));
    }
    case 'hill': {
      const dx = (x - f.x) / (f.rx || f.r), dz = (z - f.z) / (f.rz || f.r);
      return bump(Math.sqrt(dx * dx + dz * dz), f.h);
    }
    case 'ridge': {
      const c = f.axis === 'x' ? x : z;
      return bump(Math.abs(c - f.at) / (f.w / 2), f.h);
    }
  }
  return 0;
}

// 0 outside the zone, rising to 1 at its centre (ellipses) or anywhere
// inside (rectangles).
export function zoneDepth(zone, x, z) {
  const dx = Math.abs(x - zone.x) / (zone.w / 2), dz = Math.abs(z - zone.z) / (zone.d / 2);
  if (zone.rect) return dx <= 1 && dz <= 1 ? 1 : 0;
  const d = Math.sqrt(dx * dx + dz * dz);
  return d >= 1 ? 0 : smooth((1 - d) / 0.35);
}

export function zoneContains(zone, x, z, scale = 1) {
  const dx = (x - zone.x) / (zone.w / 2 * scale), dz = (z - zone.z) / (zone.d / 2 * scale);
  if (zone.rect) return Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
  return dx * dx + dz * dz <= 1;
}

// Replaces every corner of an outline with a smooth curve, so rails bend
// round rather than meeting at a point. `r` is how far back along each edge
// the curve starts (shortened on short edges).
export function roundShape(pts, r, steps = 6) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, pz] = pts[i];
    const [ax, az] = pts[(i + n - 1) % n], [bx, bz] = pts[(i + 1) % n];
    const la = Math.hypot(ax - px, az - pz), lb = Math.hypot(bx - px, bz - pz);
    const t = Math.min(r, la * 0.45, lb * 0.45);
    const p1 = [px + ((ax - px) * t) / la, pz + ((az - pz) * t) / la];
    const p2 = [px + ((bx - px) * t) / lb, pz + ((bz - pz) * t) / lb];
    // A quadratic curve from p1 to p2 with the corner as its control point.
    for (let k = 0; k <= steps; k++) {
      const u = k / steps, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      out.push([a * p1[0] + b * px + c * p2[0], a * p1[1] + b * pz + c * p2[1]]);
    }
  }
  // Drop points that landed on top of each other (straight-through corners).
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
  });
}

export function insidePolygon(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function makeTerrain(hole) {
  const ground = hole.ground || [];
  const zones = hole.zones || [];
  const [cx, cz] = hole.cup;

  const raw = (x, z) => {
    let h = 0;
    for (const f of ground) h += featureHeight(f, x, z);
    for (const zone of zones) {
      if (zone.type === 'sand') h -= SAND_DIP * zoneDepth(zone, x, z);
    }
    return h;
  };
  const cupLevel = raw(cx, cz);

  // The green round the cup is always flat, so a ball can come to rest
  // next to it and drops in fairly.
  const height = (x, z) => {
    const h = raw(x, z);
    const d = Math.hypot(x - cx, z - cz);
    if (d >= CUP_FLAT_OUT) return h;
    const t = smooth((d - CUP_FLAT_IN) / (CUP_FLAT_OUT - CUP_FLAT_IN));
    return cupLevel + (h - cupLevel) * t;
  };

  const EPS = 0.02;
  const grad = (x, z) => [
    (height(x + EPS, z) - height(x - EPS, z)) / (2 * EPS),
    (height(x, z + EPS) - height(x, z - EPS)) / (2 * EPS),
  ];

  // The last matching zone wins, so later zones sit on top of earlier ones.
  const surfaceAt = (x, z) => {
    for (let i = zones.length - 1; i >= 0; i--) {
      if (zoneContains(zones[i], x, z)) return zones[i].type;
    }
    return hole.surface || 'grass';
  };

  const renderHeight = (x, z) => {
    let h = height(x, z);
    for (const zone of zones) {
      if (zone.type === 'water') h -= WATER_DIP * zoneDepth(zone, x, z);
    }
    return h;
  };

  return { height, grad, surfaceAt, renderHeight, cupLevel };
}
