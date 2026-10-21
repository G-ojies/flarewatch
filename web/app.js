const RPC = 'https://api.devnet.solana.com';
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n.toLocaleString('en-GB');
const placeName = (s) => (s.place ? [s.place.area, s.place.state].filter(Boolean).join(', ') : s.id);

async function json(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256OfUrl(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  return hex(await crypto.subtle.digest('SHA-256', await r.arrayBuffer()));
}
async function accountBytes(address) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] }),
  });
  const v = (await r.json()).result?.value;
  if (!v) return null;
  return Uint8Array.from(atob(v.data[0]), (c) => c.charCodeAt(0));
}

function renderStats(index, flares) {
  const anchored = index.days.filter((d) => d.anchor).length;
  $('stats').innerHTML = [
    ['hot', flares.length, 'persistent flares'],
    ['', index.totals.days, 'nights watched'],
    ['', fmt(index.totals.detections), 'satellite detections'],
    ['', anchored, 'nights fixed on Solana'],
  ].map(([c, n, l]) => `<div class="stat ${c}"><b>${n}</b><span>${l}</span></div>`).join('');
}

function nightStrip(site, days) {
  const on = new Set(site.nights.map((n) => n.day));
  return `<span class="nights" title="${site.nightsActive} of ${days.length} nights">${days.map((d) => `<i class="${on.has(d.day) ? 'on' : ''}"></i>`).join('')}</span>`;
}

let map;
const markers = new Map();
function renderMap(sites, days) {
  map = L.map('leaflet', { scrollWheelZoom: false }).setView([5.2, 6.4], 8);
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
  L.tileLayer(`${esri}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 16,
    attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  }).addTo(map);
  L.tileLayer(`${esri}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: 'shadowPane' }).addTo(map);
  for (const s of [...sites].reverse()) {
    const r = s.flare ? 5 + Math.min(14, Math.sqrt(s.meanFrp) * 3.2) : 3.5;
    const m = L.circleMarker([s.lat, s.lon], {
      radius: r,
      color: s.flare ? '#ff7a1a' : '#8a8178',
      weight: s.flare ? 1.5 : 1,
      fillColor: s.flare ? '#ff9a3c' : '#8a8178',
      fillOpacity: s.flare ? 0.55 : 0.35,
    }).addTo(map);
    m.bindPopup(
      `<b>${esc(placeName(s))}</b><br>` +
      `<span class="muted">${s.flare ? 'Persistent flare' : 'Other hotspot'} · ${esc(s.id)}</span><br>` +
      `Seen ${s.nightsActive} of ${days.length} nights ${nightStrip(s, days)}<br>` +
      `Mean FRP ${s.meanFrp} MW · peak ${s.maxFrp} MW · ${s.detections} detections`,
    );
    markers.set(s.id, m);
  }
}

function renderStates(flares) {
  const counts = {};
  for (const s of flares) counts[s.place?.state || 'Unknown'] = (counts[s.place?.state || 'Unknown'] || 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  $('states').innerHTML = rows.map(([st, n]) =>
    `<div class="bar"><span>${esc(st)}</span><span class="track"><span class="fill" style="width:${(n / max) * 100}%"></span></span><span class="n">${n}</span></div>`).join('');
  const sel = $('state-filter');
  sel.innerHTML += rows.map(([st]) => `<option>${esc(st)}</option>`).join('');
}

function renderNightly(days) {
  const max = Math.max(...days.map((d) => d.detections), 1);
  $('nightly').innerHTML = days.map((d) =>
    `<div class="bar"><span class="mono">${d.day.slice(5)}</span><span class="track"><span class="fill" style="width:${(d.detections / max) * 100}%"></span></span><span class="n">${d.detections}</span></div>`).join('');
}

function renderFlares(flares, days) {
  const st = $('state-filter').value;
  const rows = flares.filter((s) => !st || (s.place?.state || 'Unknown') === st);
  $('flare-rows').innerHTML = rows.map((s) => `
    <tr class="flare-row" data-id="${esc(s.id)}">
      <td class="place"><b>${esc(s.place?.area || s.id)}</b> <span>${esc(s.place?.state || '')}</span></td>
      <td>${nightStrip(s, days)} <span class="muted small">${s.nightsActive}/${days.length}</span></td>
      <td class="num">${s.meanFrp} MW</td>
      <td class="num">${s.maxFrp} MW</td>
      <td class="mono">${esc(s.id)}</td>
    </tr>`).join('');
}

function renderLedger(index) {
  $('ledger-rows').innerHTML = index.days.map((d, i) => `
    <tr>
      <td class="mono">${d.day}</td>
      <td class="num">${d.detections}</td>
      <td class="num">${d.flareSites}</td>
      <td class="mono"><a href="data/${d.file}" title="${d.sha256}">${d.sha256.slice(0, 12)}…</a></td>
      <td>${d.anchor ? `<a href="${explorer('tx', d.anchor.tx)}" target="_blank" rel="noopener">tx</a> · <a href="${explorer('address', d.anchor.account)}" target="_blank" rel="noopener">account</a>` : '<span class="muted">pending</span>'}</td>
      <td>${d.anchor ? `<button class="btn ghost small" data-i="${i}">Verify</button> <span id="v${i}"></span>` : ''}</td>
    </tr>`).join('');
}

async function verifyDay(d, i) {
  const out = $(`v${i}`);
  out.textContent = 'checking…';
  out.className = 'muted';
  try {
    const [local, acct] = await Promise.all([sha256OfUrl(`data/${d.file}`), accountBytes(d.anchor.account)]);
    if (!acct) throw new Error('account not found');
    const onchain = hex(acct.slice(12, 44).buffer);
    const ok = local === onchain;
    out.textContent = ok ? 'matches chain' : 'DOES NOT MATCH';
    out.className = ok ? 'ok' : 'bad';
    out.title = `file ${local}\nchain ${onchain}`;
  } catch (e) {
    out.textContent = `error: ${e.message}`;
    out.className = 'bad';
  }
}

async function verifyMethod(index) {
  const out = $('method-result');
  out.textContent = 'checking…';
  out.className = 'muted';
  const [local, acct] = await Promise.all([sha256OfUrl('METHOD.md'), accountBytes(index.registry)]);
  const onchain = acct ? hex(acct.slice(40, 72).buffer) : '';
  const ok = local === onchain;
  out.textContent = ok ? `matches the registry (${local.slice(0, 12)}…)` : 'does not match the registry';
  out.className = ok ? 'ok' : 'bad';
}

(async () => {
  const [index, sites, brief] = await Promise.all([json('data/index.json'), json('data/sites.json'), json('data/brief.json').catch(() => null)]);
  const flares = sites.filter((s) => s.flare);
  const days = index.days;
  renderStats(index, flares);
  if (brief) {
    $('brief-text').textContent = brief.text;
    $('brief-src').textContent = `${brief.source} · ${brief.generated.slice(0, 10)}`;
  } else {
    $('brief').hidden = true;
  }
  renderMap(sites, days);
  renderStates(flares);
  renderNightly(days);
  renderFlares(flares, days);
  renderLedger(index);
  $('chain-ids').innerHTML =
    `Program <a href="${explorer('address', index.programId)}" target="_blank" rel="noopener" class="mono">${index.programId}</a> · ` +
    `Registry <a href="${explorer('address', index.registry)}" target="_blank" rel="noopener" class="mono">${index.registry}</a> (Solana devnet)`;

  $('state-filter').addEventListener('change', () => renderFlares(flares, days));
  $('flare-rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const s = sites.find((x) => x.id === tr.dataset.id);
    document.getElementById('map').scrollIntoView();
    map.setView([s.lat, s.lon], 11);
    markers.get(s.id).openPopup();
  });
  $('ledger-rows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) verifyDay(days[b.dataset.i], b.dataset.i);
  });
  $('verify-all').addEventListener('click', async () => {
    for (const [i, d] of days.entries()) if (d.anchor) await verifyDay(d, i);
  });
  $('verify-method').addEventListener('click', () => verifyMethod(index));
})();
