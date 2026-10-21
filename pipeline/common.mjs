import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const DATA_DIR = `${ROOT}/web/data`;
export const DAYS_DIR = `${DATA_DIR}/days`;
export const BOX = { latMin: 3.8, latMax: 7.0, lonMin: 4.5, lonMax: 9.0 };
export const LINK_KM = 1.0;
export const PROGRAM_ID = '9fWTsjzHwtY3rvai9Mdsz1gidXq2H4oGBunjnwVcSu9U';
export const REGISTRY = 'Bv2gQoRWHEonXQbVgfH5uudqBh3oU1xXiJU1HdYKHYd1';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function loadDays() {
  return readdirSync(DAYS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => {
      const raw = readFileSync(`${DAYS_DIR}/${f}`);
      return { file: f, raw, digest: sha256(raw), ...JSON.parse(raw) };
    });
}

export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Single-linkage clustering at LINK_KM (METHOD.md section 4). Points need
// {lat, lon}; returns arrays of points, one per site.
export function cluster(points) {
  const parent = points.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cell = 0.01; // about 1.1 km, so neighbours within 1 km sit in adjacent cells
  const grid = new Map();
  points.forEach((p, i) => {
    const key = `${Math.floor(p.lat / cell)},${Math.floor(p.lon / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  points.forEach((p, i) => {
    const gy = Math.floor(p.lat / cell), gx = Math.floor(p.lon / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const j of grid.get(`${gy + dy},${gx + dx}`) || []) {
        if (j > i && km(p, points[j]) <= LINK_KM) parent[find(i)] = find(j);
      }
    }
  });
  const groups = new Map();
  points.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  return [...groups.values()];
}

export const toPoints = (day) =>
  day.detections.map((d) => ({ day: day.day, lat: Number(d[0]), lon: Number(d[1]), frp: Number(d[2]), time: d[4], sat: d[5] }));

// The three numbers stored on chain next to the digest (METHOD.md section 3).
export function dayStats(day) {
  const pts = toPoints(day);
  return {
    flareSites: cluster(pts).length,
    detections: pts.length,
    totalFrpKw: Math.round(pts.reduce((s, p) => s + p.frp, 0) * 1000),
  };
}
