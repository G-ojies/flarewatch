// Write a short plain-English brief of the latest data with an LLM (Groq), from
// facts computed here. The model may only restate these facts: any number in
// its answer that is not in the facts rejects the answer, and the brief falls
// back to a fixed template. Needs GROQ_API_KEY; without it the template is used.
import { readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from './common.mjs';

const index = JSON.parse(readFileSync(`${DATA_DIR}/index.json`, 'utf8'));
const sites = JSON.parse(readFileSync(`${DATA_DIR}/sites.json`, 'utf8'));
const flares = sites.filter((s) => s.flare);
const latest = index.days.at(-1);

const byState = {};
for (const s of flares) byState[s.place?.state || 'Unknown'] = (byState[s.place?.state || 'Unknown'] || 0) + 1;
const states = Object.entries(byState).sort((a, b) => b[1] - a[1]);
const hottest = [...flares].sort((a, b) => b.meanFrp - a.meanFrp).slice(0, 3);
const where = (s) => [s.place?.area, s.place?.state].filter(Boolean).join(', ') || s.id;

const facts = {
  period: `${index.days[0].day} to ${latest.day}`,
  nightsCovered: index.days.length,
  persistentFlares: flares.length,
  otherHotspotSites: sites.length - flares.length,
  flaresByState: Object.fromEntries(states),
  flaresSeenOnEveryNight: flares.filter((s) => s.nightsActive === index.days.length).length,
  hottestFlares: hottest.map((s) => ({ where: where(s), meanFrpMW: s.meanFrp, nightsActive: s.nightsActive })),
  latestNight: { day: latest.day, detections: latest.detections, hotspotSitesSeen: latest.flareSites },
};

// The model gets the facts already phrased, so a number cannot drift onto the wrong label.
const phrases = [
  `Period: ${facts.period}, ${facts.nightsCovered} nights of satellite passes.`,
  `${facts.persistentFlares} sites qualified as persistent gas flares (seen on 3 or more nights within 7 days).`,
  `${facts.otherHotspotSites} other hotspot sites were seen too rarely to count as flares.`,
  `Persistent flares by state: ${states.map(([st, n]) => `${st} ${n}`).join(', ')}.`,
  `${facts.flaresSeenOnEveryNight} persistent flares were detected on every one of the ${facts.nightsCovered} nights.`,
  `Hottest persistent flares by average radiant heat (FRP): ${facts.hottestFlares.map((h) => `${h.where}, ${h.meanFrpMW} MW, seen on ${h.nightsActive} nights`).join('; ')}.`,
  `Latest night, ${latest.day}: ${latest.detections} satellite detections at ${latest.flareSites} hotspot sites. Cloud can hide flares on any night, so a low count does not mean flares stopped.`,
];

const template = `Over ${facts.nightsCovered} nights (${facts.period}), satellites found ${facts.persistentFlares} gas flares burning persistently across the Niger Delta. ` +
  `${states.slice(0, 3).map(([st, n]) => `${st} has ${n}`).join(', ')}. ` +
  `The strongest is in ${facts.hottestFlares[0]?.where}, averaging ${facts.hottestFlares[0]?.meanFrpMW} MW of radiant heat.`;

const numbersIn = (t) => (t.match(/\d+(?:\.\d+)?/g) || []).map(Number);
const allowed = new Set(numbersIn(phrases.join(' ')));

async function ask() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 4000,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: 'You write a brief of at most 4 short sentences and 100 words for residents and journalists in the Niger Delta about gas flaring seen by satellite. Use only the facts given, keeping each number with the exact label it has in the facts (a detection is not a flare, a hotspot site is not a flare). Every number you write must appear in the facts. Plain words, no em dashes, no hashtags, no speculation about companies, health or causes. FRP is radiant heat in megawatts, not gas volume. Do not try to include every fact: pick the most important ones, name at most three states and at most two hottest flares.' },
          { role: 'user', content: phrases.join('\n') },
        ],
      }),
    });
    if (!res.ok) { console.log(`brief: ${model} HTTP ${res.status}`); continue; }
    const choice = (await res.json()).choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text || choice.finish_reason !== 'stop') { console.log(`brief: ${model} incomplete`); continue; }
    const bad = numbersIn(text).filter((n) => !allowed.has(n));
    const words = text.split(/\s+/).length;
    if (bad.length || /—/.test(text) || words > 110) { console.log(`brief: ${model} rejected (${bad.join(', ') || (words > 110 ? words + ' words' : 'em dash')})`); continue; }
    return { text, model };
  }
  return null;
}

const ai = await ask();
const brief = { generated: new Date().toISOString(), text: ai?.text || template, source: ai ? `AI (${ai.model}, Groq), checked against the facts` : 'template', facts };
writeFileSync(`${DATA_DIR}/brief.json`, JSON.stringify(brief, null, 1) + '\n');
console.log(`brief (${brief.source}):\n${brief.text}`);
