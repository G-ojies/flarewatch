// Build the site list and flare classification from every published day file
// (METHOD.md sections 4 and 5), plus the index the website reads.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR, PROGRAM_ID, REGISTRY, cluster, dayStats, loadDays, toPoints } from './common.mjs';

const MIN_NIGHTS = 3;
const SPAN_DAYS = 7;
const dayNum = (d) => Date.parse(d + 'T00:00:00Z') / 86_400_000;
const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

function persistent(nights) {
  const t = nights.map(dayNum).sort((a, b) => a - b);
  for (let i = 0; i + MIN_NIGHTS - 1 < t.length; i++) {
    if (t[i + MIN_NIGHTS - 1] - t[i] <= SPAN_DAYS - 1) return true;
  }
  return false;
}

const days = loadDays();
const places = existsSync(`${DATA_DIR}/places.json`) ? JSON.parse(readFileSync(`${DATA_DIR}/places.json`, 'utf8')) : {};
const anchors = existsSync(`${DATA_DIR}/anchors.json`) ? JSON.parse(readFileSync(`${DATA_DIR}/anchors.json`, 'utf8')) : {};

const sites = cluster(days.flatMap(toPoints)).map((pts) => {
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const id = `${lat.toFixed(2)}N ${lon.toFixed(2)}E`;
  const byNight = {};
  for (const p of pts) {
    const n = (byNight[p.day] ||= { day: p.day, detections: 0, maxFrp: 0, sumFrp: 0 });
    n.detections++;
    n.maxFrp = Math.max(n.maxFrp, p.frp);
    n.sumFrp += p.frp;
  }
  const nights = Object.values(byNight).sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((n) => ({ day: n.day, detections: n.detections, maxFrp: round(n.maxFrp, 2), meanFrp: round(n.sumFrp / n.detections, 2) }));
  const frps = pts.map((p) => p.frp);
  return {
    id,
    lat: round(lat, 4),
    lon: round(lon, 4),
    flare: persistent(nights.map((n) => n.day)),
    nightsActive: nights.length,
    detections: pts.length,
    meanFrp: round(frps.reduce((a, b) => a + b, 0) / frps.length, 2),
    maxFrp: round(Math.max(...frps), 2),
    place: places[id] || null,
    nights,
  };
}).sort((a, b) => b.flare - a.flare || b.nightsActive - a.nightsActive || b.meanFrp - a.meanFrp);

const index = {
  generated: new Date().toISOString(),
  method: 'flarewatch-method-v1',
  programId: PROGRAM_ID,
  registry: REGISTRY,
  methodSha256: '9a5577930829fed066e36c0fbf86faf5c74f5b2c53f82fd3d1d0f60554487a88',
  cluster: 'devnet',
  totals: {
    days: days.length,
    sites: sites.length,
    flares: sites.filter((s) => s.flare).length,
    detections: days.reduce((s, d) => s + d.detections.length, 0),
  },
  days: days.map((d) => ({ day: d.day, file: `days/${d.file}`, sha256: d.digest, ...dayStats(d), anchor: anchors[d.day] || null })),
};

writeFileSync(`${DATA_DIR}/sites.json`, JSON.stringify(sites) + '\n');
writeFileSync(`${DATA_DIR}/index.json`, JSON.stringify(index, null, 1) + '\n');
console.log(`${index.totals.days} days, ${index.totals.detections} detections, ${index.totals.sites} sites, ${index.totals.flares} persistent flares`);
console.log('top 8:', sites.slice(0, 8).map((s) => `${s.id} nights=${s.nightsActive} meanFrp=${s.meanFrp}`).join(' | '));
