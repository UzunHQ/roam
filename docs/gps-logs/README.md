# GPS logs

Real recordings made with `?gpslog` (see [../GPS.md](../GPS.md)) go here: one `.json` (and its `.gpx`)
per walk, named `YYYY-MM-DD-<route>.json`, e.g. `2026-11-12-chadwick-to-froebel.json`. Only real
walks: synthetic tracks stay in `scripts/check-gps.mjs`.

**Private: never committed.** This repo is public, and a real walk shows where you live and the way
you walk each day. `.gitignore` keeps every `.json` and `.gpx` in this folder out of git, so the logs
stay on your Mac. Share the numbers from `npm run gps:report`, not the log itself.
