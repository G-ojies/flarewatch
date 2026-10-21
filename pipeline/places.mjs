// Name each site (state and local area) with OpenStreetMap Nominatim, once per
// site id, cached in web/data/places.json. Nominatim allows 1 request a second.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from './common.mjs';

const path = `${DATA_DIR}/places.json`;
const places = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
const sites = JSON.parse(readFileSync(`${DATA_DIR}/sites.json`, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let added = 0;
for (const s of sites.filter((x) => !(x.id in places))) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${s.lat}&lon=${s.lon}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Flarewatch/0.1 (https://github.com/G-ojies/flarewatch)' } });
  const j = res.ok ? await res.json() : {};
  const a = j.address || {};
  places[s.id] = a.state
    ? { state: a.state.replace(/ State$/, ''), area: a.county || a.city || a.town || a.village || a.municipality || null }
    : { state: 'Offshore or coast', area: null };
  added++;
  await sleep(1200);
}
writeFileSync(path, JSON.stringify(places, null, 1) + '\n');
console.log(`places: ${added} new, ${Object.keys(places).length} total`);
