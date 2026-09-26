# CLAUDE.md

Guidance for working in this repository.

## What this is

WhatUpSF (whatupsf.com) is a Django site with two apps:

- **`apps.events`** — the main product: a full-screen Leaflet map of San Francisco
  music venues showing what is on tonight. Fed by a nightly OpenAI-based scraper.
- **`apps.marina_views`** — a separate tool that answers "what can you see from
  here", using USGS 3DEP terrain tiles and ray casting.

A single Django project (`config/`) serves both. `core/` holds shared templates
(`base.html`), shared static assets, and a SQL fixture. `etl/` holds the scraper
and its data files. `bin/` holds ops shell scripts.

## Environment & commands

The virtualenv lives **outside the repo** at `/home/kriram5/whatupsf.com/venv`
(Python 3.10, Django 2.2.28). Always use its interpreter explicitly:

```bash
VENV=/home/kriram5/whatupsf.com/venv/bin
$VENV/python manage.py check
$VENV/python manage.py collectstatic --noinput
$VENV/python manage.py test apps.marina_views   # the only real test suite
```

`apps/marina_views/tests.py` uses `SimpleTestCase` with unsaved model instances
on purpose, so it runs with no test database. Any test that touches the DB needs
live MySQL credentials; there is no local sqlite fallback.

### Deployment

Bare gunicorn daemon on `173.236.219.130:8000`, behind DreamHost-managed nginx,
WSGI module `config.wsgi:application`. There is no systemd unit — a cron job runs
`bin/gunicorn_watchdog.sh` every 5 minutes and restarts gunicorn if the port is
dead. `~/restart_whatupsf.sh` force-restarts by hand.

**The crontab is not in git.** After changing project layout, the WSGI module
path, the venv location, or the bind address, check `crontab -l` as well — a
stale cron line caused a multi-day outage once. Current jobs:

| Schedule | Job |
|---|---|
| `*/5 * * * *` | `bin/gunicorn_watchdog.sh` |
| `59 5 * * *` | `etl/daily_scraper.py --dump-only` (refresh `publish.json`) |
| `0 3 * * 0` | `etl/daily_scraper.py` (full scrape, Sundays) |
| `30 7 * * *` | `bin/site_health_report.sh` (silent when healthy) |
| `35 7 * * 1` | `bin/site_health_report.sh --heartbeat` |

`bin/traffic_report.sh` reads nginx access logs; the app keeps no analytics.

## How map data actually flows

This is the most important thing to understand before changing anything:

**The map does not query the database at request time.** `map_view.render_json`
reads `etl/publish.json` off disk and returns it verbatim. Both `/json/` and
`/api/map-data.json` do this. So:

- Editing the DB changes nothing on the site until `publish.json` is regenerated
  (`daily_scraper.py --dump-only`, which calls `venueETL.dump_latest_info()`).
- `publish.json` only ever contains events for `CURDATE()`, which is why the
  5:59am cron job exists — it is what makes "tonight" mean today.
- The generating query in `venueETL.get_latest_info()` excludes Outside Lands
  stages (`V.url NOT LIKE '%sfoutsidelands%'`) so they are not permanent dead
  markers in Golden Gate Park.

## Legacy shape of `apps.events`

`apps/events/models.py` is `inspectdb` output against a 2014 MySQL schema
(`sfev`). Every model is `managed = False` with no foreign keys — the schema has
none. Consequences:

- Don't write ORM joins or `related_name` traversals against these models; the
  relations don't exist. Raw SQL via `venueETL.get_db_connection()` is how the
  ETL talks to the DB, and that is the established pattern.
- `apps/events/views/test_view.py` is dead legacy code that references fields
  (`venue__id`, `event.band`, `event.price`) which are not on these models. It
  will raise if reached. Don't use it as a model for new views.
- Never rename `db_table` values or field names in these models.

`apps.marina_views` is the opposite: ordinary managed models with real
migrations, deliberately carrying no FKs to `auth`/`contenttypes` so
`migrate marina_views` can run alone against the existing database.

## Frontend conventions

No build step, no bundler, no npm. `apps/events/templates/whatupsf/index.html`
loads Leaflet 1.9.4 from unpkg and `map-app.js` as a native ES module; Tailwind
comes from the CDN in `core/templates/base.html`. Page CSS lives inline in the
template.

`apps/events/static/js/map-app.js` is **wiring only** — it composes the modules
under `static/js/modules/` (`map-manager`, `markers`, `city-time`, `jukebox`,
`dock`, `ui`, `clustering`). Keep behaviour in the modules.

Two invariants worth preserving:

- **The map's zoom never changes.** `map-manager.js` pins min/max zoom to
  `FIXED_ZOOM = 13.7` (needs `zoomSnap: 0`). Selection, recentring, locate-me and
  the jukebox all must pan, never zoom.
- The module script tag carries a cache-busting query (`?v=20260810a`). Bump it
  when changing JS, or the browser will keep the old module.

## The scraper (`etl/daily_scraper.py`)

~1500 lines, four phases, run from the `etl/` directory:

1. Venue fetch + calendar URL discovery (keyword heuristic, then AI, then
   `venues.calendar_url` override; discovered URLs are written back to the DB).
2. Calendar parsing with OpenAI (`OPENAI_MODEL = 'gpt-5.4'`). If cleaned text is
   under `JS_RENDER_THRESHOLD` (1000 chars) it retries with Playwright, then
   falls back to vision on a PDF/image calendar.
3. Band lookup/insert plus AI enrichment (description, image, media URL).
4. Event insert, then `publish.json` regeneration.

```bash
cd etl
$VENV/python daily_scraper.py                      # full pipeline, logs to etl/logs/
$VENV/python daily_scraper.py --phase 2            # stop after a phase
$VENV/python daily_scraper.py --venue 28 --debug   # one venue, all phases
$VENV/python daily_scraper.py --dump-only          # just rebuild publish.json
$VENV/python daily_scraper.py --backfill-enrichment --venue 28
$VENV/python osl_ingest.py --dry-run               # Outside Lands, separate path
```

Notes:

- Phase results are cached to `etl/.scraper_cache.json` (or `_<venue_id>.json`),
  which is what `--phase 4` reloads instead of re-scraping.
- Full runs tee timestamped output to `etl/logs/scraper_YYYY-MM-DD.log`; the
  interactive flags skip logging unless you pass `--no-log`.
- Outside Lands stages are explicitly refused by `--venue`. All three days and
  all eight stages sit behind one client-side-filtered URL, so the generic
  scraper cannot attribute events correctly — it has mislabelled stages and whole
  days. Use `osl_ingest.py`, which reads the festival's JSON API.
- `etl/venueETL.py` raises at **import** time if `WHATUPSF_DB_PASSWORD` is unset.
  `daily_scraper.py` parses `../.env` by hand before importing it.

## Configuration gotchas

- `config/settings.py` tries `dotenv` in a `try/except ImportError` — and
  **python-dotenv is not installed in the venv**, so that `.env` load silently
  does nothing. Django only sees DB credentials that are already exported in the
  environment. This is survivable today because the map path reads
  `publish.json` and never opens a connection, but admin, the form views and any
  new DB-backed view will fail without exported credentials.
- `settings.py` sets `DEBUG` from the environment and then unconditionally
  overwrites it with `DEBUG = True` on the next line. Deliberate or not, it is
  live in production; don't "fix" it silently as a drive-by.
- `SECRET_KEY` falls back to `dev-insecure-key`.
- Secrets live in `.env` (gitignored): DB credentials, `OPENAI_API_KEY`,
  `ALERT_EMAIL`/`SMTP_*`. `.env.example` documents the DB keys.
- `MARINA_DEM_DIR` (default `~/geodata/3dep`) holds the 3DEP GeoTIFF tiles and
  derived `.npy` grids. They are hundreds of megabytes and intentionally outside
  the repo, so `apps.marina_views` elevation endpoints are non-functional without
  them. `rasterio`/`pyproj` wheels bundle GDAL and PROJ — no system geospatial
  libraries or root needed.
- `staticfiles/` is `STATIC_ROOT` (collectstatic output, gitignored).
  `WHITENOISE_USE_FINDERS = True` means source static files are served even
  without a collectstatic run.

## Repository etiquette

- Work happens on feature branches; `master` is the main branch.
- **Leave git stashes alone.** Do not drop, pop, or offer to clean up stashes in
  this repo, even ones you created. Work around them instead and say they exist.
- Scraper run artifacts are gitignored on purpose: `etl/logs/`,
  `etl/.scraper_cache*.json`, `etl/publish.bkp`. `etl/publish.json` *is* tracked,
  because it is what the site serves.
- `ARCHITECTURE_REVIEW.md`, `PLATFORM_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`
  and `MODERNIZATION_COMPLETE.md` are aspirational planning documents, not
  descriptions of what runs. Read them for intent; trust the code for fact.
