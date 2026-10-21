# Flarewatch detection method, version 1

The SHA-256 of this file is stored in the Flarewatch registry on Solana when the
registry is created, and it cannot be changed afterwards. If the method ever
changes, a new registry is created with the new document's hash.

## 1. Source data

NASA FIRMS near-real-time active fire detections from the three VIIRS
instruments (375 m I-band, collection 2):

- Suomi NPP: `SUOMI_VIIRS_C2_Global_7d.csv`
- NOAA-20: `J1_VIIRS_C2_Global_7d.csv`
- NOAA-21: `J2_VIIRS_C2_Global_7d.csv`

Downloaded from `https://firms.modaps.eosdis.nasa.gov/data/active_fire/`.
No API key is needed for these files.

## 2. Area and time

- Area: latitude 3.8 to 7.0 N, longitude 4.5 to 9.0 E. This covers the Niger
  Delta, onshore and offshore, across Bayelsa, Delta, Rivers, Akwa Ibom, Imo,
  Abia, Edo, Ondo and Cross River.
- Only night detections (`daynight = N`) are kept. Gas flares burn all night;
  farm and bush burning happens mostly by day, so night data separates the two
  far better.

## 3. Day files (what goes on chain)

A day file holds every kept detection whose acquisition date is that UTC day.
It holds only the observations, exactly as FIRMS published them, with no
interpretation. Each detection is the array:

    [latitude, longitude, frp, bright_ti4, acq_time, satellite, confidence]

with every value kept as the original CSV string. Rows are sorted by
acquisition time, then satellite, then latitude, then longitude. The file is
compact JSON with a trailing newline. Its SHA-256 is recorded on chain with:

- `flare_sites`: distinct locations that night (detections grouped with the
  rule in section 4, applied to that day only)
- `detections`: number of rows
- `total_frp_kw`: sum of fire radiative power, in kilowatts, rounded

A day is published only once it is complete: the day must be at least one full
day old, and the first day of a 7-day download is skipped because it may be
partial.

## 4. Sites

Detections across all published days are grouped into sites by single-linkage
clustering: two detections belong to the same site when they are within 1.0 km
of each other (haversine distance). A site's position is the mean of its
detections. Its id is that position rounded to 2 decimal places.

## 5. Flare classification

A site is classed as a **persistent flare** when it was detected on at least 3
distinct nights within some 7-day span. Other sites are **transient** (most
likely fires, or a flare seen too rarely to be sure).

## 6. What the numbers mean

FRP (fire radiative power, MW) is the heat the sensor sees at the moment of the
pass. It shows how hard a flare is burning relative to others and over time. It
is not converted into a gas volume or a CO2 figure here: that needs a
calibration this project does not claim. A night with no detection can mean the
flare was off, or that cloud hid it.
