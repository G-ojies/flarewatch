# Devpost submission: Flarewatch

**Name:** Flarewatch

**Tagline (short):** Niger Delta gas flares, seen from space every night, on a record nobody can quietly edit.

**Track:** Climate Data & Environmental Monitoring

**Links**

- Live demo: https://flarewatch-ng.vercel.app
- Code: https://github.com/G-ojies/flarewatch
- Video: https://youtu.be/aIjtqPHqlmc
- Solana program (devnet): https://explorer.solana.com/address/9fWTsjzHwtY3rvai9Mdsz1gidXq2H4oGBunjnwVcSu9U?cluster=devnet

**Built with:** solana, anchor, rust, javascript, node.js, nasa-firms, viirs, leaflet, openstreetmap, groq, gpt-oss, vercel, github-actions

---

## Inspiration

I live in Benin City, at the edge of the Niger Delta. Gas that comes up with crude oil is burned off in open flares across the Delta every night, close to homes and farms. It wastes energy and puts CO2 and soot into the air.

Satellites already see every one of those flares. NASA's VIIRS sensors pass over several times a night and record each flare's heat. But that data is a rolling seven-day download that disappears, it is hard for a non-specialist to read, and nothing stops a report built on it from being revised later. A community, a journalist or a regulator who wants to say "this flare burned on these nights" has no record they can point to and prove.

## What it does

Flarewatch turns the satellite data into a public, tamper-evident record of gas flaring in the Niger Delta.

- **Collects** every night-time VIIRS detection in the Delta from all three satellites (Suomi NPP, NOAA-20, NOAA-21) through NASA FIRMS.
- **Fixes each night on Solana.** A complete night becomes a file of the untouched NASA detections. Its SHA-256 hash is written to a Solana program that can record a night once and never again. There is no update and no delete instruction.
- **Finds the flares.** Detections within 1 km form a site, and a site seen on 3 or more nights within 7 days is a persistent flare. The rules are in a method document whose hash is fixed in the on-chain registry, so the method cannot change quietly either.
- **Explains it.** A map, a per-flare night-by-night history, counts by state, and a short AI-written brief.
- **Lets anyone check.** In the Ledger, the Verify button downloads a night's file, hashes it in the browser, reads the hash stored on Solana and compares them. Nothing asks you to trust the website.

In its first six nights (15 to 20 October 2026) it logged 675 detections and found **48 persistent flares**: 20 in Rivers, 13 in Delta, 6 in Bayelsa, 4 in Edo (one in Ikpoba-Okha, near Benin City), plus coastal, Akwa Ibom and Imo sites.

## How I built it

- **Pipeline (Node.js):** streams the three FIRMS 7-day CSVs, keeps night detections in the Delta box, and writes one canonical JSON file per complete UTC day. A published file is never rewritten: if NASA's data changes later, the difference is reported and the original is kept.
- **Solana program (Rust, Anchor 1.0):** `initialize(method_digest)` creates the registry PDA and locks in the method's hash. `record_day(day, digest, sites, detections, frp)` creates a PDA per day with `init`, so a second write for the same day fails. It also rejects non-dates, future days, empty digests and inconsistent counts. Tests in LiteSVM cover recording, rewrites, a stranger trying to write, bad input and double initialisation.
- **Classification:** single-linkage clustering at 1 km with haversine distance, then the 3-of-7-nights persistence rule. OpenStreetMap's Nominatim names each site's state and local area.
- **AI brief:** gpt-oss-120b on Groq writes the summary from facts computed in code. The model is given each fact already phrased with its label, and any answer containing a number that is not in those facts, an em dash, or too many words is thrown out. If no answer passes, a fixed template is used.
- **Website:** a static site on Vercel with a Leaflet map. Verification runs entirely in the browser with the Web Crypto API and a direct Solana RPC call.

## Challenges I ran into

- **Is a quiet night missing data or cloud?** Two nights had far fewer detections. Before recording anything I checked every satellite pass for every night: all three satellites passed each night, so the low counts are rainy-season cloud, not gaps. The page says so, because a missing detection must never read as "the flare stopped".
- **Recording facts, not opinions.** My first design put the flare classification on chain. But whether a site counts as a flare depends on the nights around it, so the record would have changed as new nights arrived. I moved the chain record down to the raw observations, which never change, and locked the method with its own hash.
- **Keeping the AI honest.** The first briefs had every number right but put some on the wrong label, for example calling 23 detections "23 flares". A simple number check cannot catch that, so the model now receives each fact as a complete phrase.

## Accomplishments that I'm proud of

- A tamper test that works in front of you: change a single digit in one night's file and that night stops matching the chain while every other night still matches.
- Real data from the first day: 48 persistent flares, named down to the local government area.
- Honest limits on the page itself. Fire radiative power is heat, not gas volume, so Flarewatch does not invent a carbon figure.

## What I learned

How VIIRS active-fire data is structured (passes, FRP, day/night flags), how to design an on-chain record that stays true as new data arrives, and that guarding an LLM takes more than checking its numbers.

## What's next for Flarewatch

- Run the daily GitHub Action with a funded key, then move the program to mainnet.
- Add history from the FIRMS archive (needs a free key) and NOAA's Nightfire flare-volume estimates where they are published.
- Alerts for a new flare or a long-dormant one coming back, and a per-flare page that a community or journalist can cite.
- Cover other flaring regions with the same program, one registry per region.

## Limits

FRP is radiant heat at the moment of a pass, not gas volume or CO2. A night with no detection may be cloud. History starts on 15 October 2026. The program runs on Solana devnet.

## AI disclosure

Claude Code (Anthropic's Claude) helped plan, write and test the code, the program and the demo video pipeline. Inside the app, gpt-oss-120b on Groq writes the daily brief from computed facts. The narration is synthesised with Piper TTS.
