# Flarewatch

**Niger Delta gas flares, seen from space every night, on a record nobody can quietly edit.**

Live: https://flarewatch-ng.vercel.app · Program (Solana devnet): [`9fWTsjzHwtY3rvai9Mdsz1gidXq2H4oGBunjnwVcSu9U`](https://explorer.solana.com/address/9fWTsjzHwtY3rvai9Mdsz1gidXq2H4oGBunjnwVcSu9U?cluster=devnet)

Track: **Climate Data & Environmental Monitoring** (IEEE ClimateChain Global Hackathon).

## The problem

Nigeria flares gas in the Niger Delta every night: the gas that comes up with
crude oil is burned off instead of being captured. It wastes energy, puts CO2
and soot into the air, and the flares sit close to homes and farms.

Satellites already see every flare. NASA's VIIRS sensors pass over several
times a night and record each one's heat. But the data is a rolling 7-day
download that disappears, it is hard to read, and nothing stops a report built
on it from being revised after the fact. Communities, journalists and
regulators who want to say "this flare burned on these nights" have no record
they can point to and prove.

## What Flarewatch does

1. **Collects** every night-time VIIRS detection in the Niger Delta from all three satellites (Suomi NPP, NOAA-20, NOAA-21) through NASA FIRMS.
2. **Fixes each night on Solana.** A complete night becomes a file of the untouched NASA detections. Its SHA-256 is written to a Solana program that can record a night **once and never again**: there is no update or delete instruction.
3. **Classifies flares.** Detections within 1 km form a site. A site seen on 3 or more nights within 7 days is a persistent flare. The rules live in [METHOD.md](METHOD.md), and that file's hash is fixed in the on-chain registry, so the method cannot change quietly either.
4. **Explains it.** A map, a per-flare history, counts by state, and a short AI-written brief. The brief is generated from facts computed in code, and any number it writes that is not in those facts gets it rejected.
5. **Lets anyone check.** The Ledger section hashes each night's file in your browser and compares it with the hash on Solana. No trust in this website is needed.

First week (15 to 20 Oct 2026): **48 persistent flares** across 91 hotspot sites and 675 detections. Rivers 20, Delta 13, Bayelsa 6, Edo 4.

## How it fits together

```
NASA FIRMS (3 VIIRS satellites)
        │  pipeline/fetch.mjs     night detections in the Delta box → web/data/days/YYYY-MM-DD.json (write-once)
        ▼
web/data/days/*.json ──► pipeline/anchor.mjs ──► Solana program: record_day(day, sha256, sites, detections, frp)
        │
        ├─► pipeline/derive.mjs   1 km clustering, 3-of-7-nights rule → sites.json, index.json
        ├─► pipeline/places.mjs   OpenStreetMap names (state, local area), cached
        └─► pipeline/brief.mjs    AI brief (Groq, gpt-oss-120b) from pre-phrased facts, number-checked
                                  ▼
                        web/ (static site: Leaflet map, flare table, ledger with in-browser verification)
```

### Solana program (`programs/flarewatch`, Anchor 1.0)

- `initialize(method_digest)`: creates the registry PDA `["registry"]` and fixes the method document's SHA-256.
- `record_day(day, digest, flare_sites, detections, total_frp_kw)`: creates a `DayRecord` PDA `["day", day_le]`. Only the registry authority can call it. It rejects non-dates, future days, zero digests and inconsistent counts. Because the account is created with `init`, a second write for the same day fails.

Tests (LiteSVM): `cargo test -p flarewatch` covers recording, the registry counters, refusing a rewrite, refusing a stranger, input validation and double initialization.

### Verify it yourself

```bash
curl -s https://flarewatch-ng.vercel.app/data/days/2026-10-18.json | sha256sum
solana account <DayRecord address from the ledger> -u devnet --output json   # bytes 12..44 are the digest
```

## Run it

```bash
npm install
npm run daily          # fetch → derive → places → anchor → derive → brief
cargo test -p flarewatch
```

`anchor.mjs` signs with `~/.config/solana/id.json`, or `FLAREWATCH_SECRET` (a JSON byte array). `brief.mjs` uses `GROQ_API_KEY` and falls back to a fixed template without it.

The GitHub Action in `.github/workflows/daily.yml` runs the pipeline every morning and commits the new night. It records on chain only when the `FLAREWATCH_SECRET` repository secret is set.

## Limits, stated plainly

- FRP is radiant heat in megawatts at the moment of a pass. It is **not** converted into gas volume or CO2 here.
- Cloud hides flares. A night with no detection does not prove a flare was off.
- History starts on 15 Oct 2026, when recording began. Older FIRMS archives need an API key.
- The program runs on devnet. Mainnet only needs a funded authority key.

## Credits

Data: NASA FIRMS (VIIRS 375 m NRT). Place names: OpenStreetMap contributors via Nominatim. Basemap: Esri. Built in Benin City, Nigeria, by Great Ojietohamen.
