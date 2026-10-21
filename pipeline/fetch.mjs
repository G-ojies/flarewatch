// Download the three VIIRS 7-day files from NASA FIRMS, keep night detections
// in the Niger Delta box, and write one canonical file per complete UTC day
// (METHOD.md sections 1 to 3). A day file that already exists is never
// rewritten: if fresh data disagrees, the difference is reported and the
// published file stays as it is.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { DAYS_DIR, BOX } from './common.mjs';

const BASE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
const SOURCES = [
  `${BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv`,
  `${BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv`,
  `${BASE}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv`,
];
const COLS = ['latitude', 'longitude', 'frp', 'bright_ti4', 'acq_time', 'satellite', 'confidence'];

async function readSource(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const lines = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });
  let header = null;
  const rows = [];
  const dates = new Set();
  for await (const line of lines) {
    if (!line) continue;
    const f = line.split(',');
    if (!header) { header = Object.fromEntries(f.map((k, i) => [k, i])); continue; }
    dates.add(f[header.acq_date]);
    if (f[header.daynight] !== 'N') continue;
    const lat = Number(f[header.latitude]), lon = Number(f[header.longitude]);
    if (lat < BOX.latMin || lat > BOX.latMax || lon < BOX.lonMin || lon > BOX.lonMax) continue;
    rows.push({ date: f[header.acq_date], row: COLS.map((c) => f[header[c]]) });
  }
  return { rows, dates };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortRows = (rows) =>
  rows.sort((a, b) => cmp(a[4], b[4]) || cmp(a[5], b[5]) || cmp(a[0], b[0]) || cmp(a[1], b[1]));

export function dayFile(day, rows) {
  return JSON.stringify({
    day,
    method: 'flarewatch-method-v1',
    box: BOX,
    columns: COLS,
    detections: sortRows(rows),
  }) + '\n';
}

async function main() {
  mkdirSync(DAYS_DIR, { recursive: true });
  const byDay = new Map();
  let complete = null;
  for (const url of SOURCES) {
    const { rows, dates } = await readSource(url);
    console.log(`${url.split('/').pop()}: ${rows.length} kept, dates ${[...dates].sort().join(' ')}`);
    // Only days covered by every source count, minus the first (maybe partial) one.
    const covered = [...dates].sort().slice(1);
    complete = complete ? complete.filter((d) => covered.includes(d)) : covered;
    for (const { date, row } of rows) {
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date).push(row);
    }
  }
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  for (const day of complete.filter((d) => d <= yesterday)) {
    const body = dayFile(day, byDay.get(day) || []);
    const path = `${DAYS_DIR}/${day}.json`;
    const digest = createHash('sha256').update(body).digest('hex');
    if (existsSync(path)) {
      const old = readFileSync(path, 'utf8');
      if (old !== body) console.log(`${day}: FIRMS data changed since publication; keeping the published file`);
      continue;
    }
    writeFileSync(path, body);
    console.log(`${day}: wrote ${(byDay.get(day) || []).length} detections, sha256 ${digest}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
