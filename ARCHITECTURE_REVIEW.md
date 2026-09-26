# WhatUpSF — Architecture Review & Modernization Plan

**Review date:** 2026-07-26
**Reviewed at commit:** `16f8414` (branch `master`)
**Scope:** full read of all 13 Python files, every template and JS module, both existing design docs, the crontab, the deploy script, and the scraper logs.
**Changes made to the codebase:** none. This document is analysis only.

---

## 0. Effort estimate at a glance

| Stage | Work | Hands-on effort | Risk |
|---|---|---|---|
| 0 | Safety net (dump, verify restore, dev env, tag) | **0.5 day** | none |
| 1 | Security & reliability quick wins (items 1-9) | **0.5 day** | trivial |
| 2 | Foundations: deps, tests, InnoDB (10, 12, 15) | **2 days** | medium |
| 3 | Reclaim the ORM: models, migrations, FKs, admin (11, 13, 14, 20) | **2-3 days** | medium |
| 4 | Restructure: package move, split ETL, DB-backed API (16-18, 21) | **3-4 days** | medium |
| 5 | Django 2.2 → 4.2 LTS (→ 5.x) (19) | **2 days** | medium-high |
| 6 | Cleanup & frontend build (22, 23) | **2-3 days** | low |
| | **Total** | **≈ 12.5-15.5 working days** | |

**Calendar time is longer than effort.** Stage 5 requires observation windows of several
days between each Django version bump, and Stages 2 and 4 want a full weekly scraper run
to validate against. Realistically **4-6 weeks elapsed** at a part-time pace, or
**≈3 weeks** if worked continuously.

**The highest-leverage slice is Stage 0 + Stage 1 — one day total.** That alone closes
both critical security holes (§2.1, §2.2), restores crash recovery (§2.4), stops the
torn-JSON failure mode (§2.5), and removes two broken endpoints. Everything after it is
maintainability rather than exposure. If only one day is ever available, spend it there
and stop.

Two caveats on the estimate:

- It assumes the open question in §6 resolves the *easy* way. If `python-dotenv` is not
  installed in the venv, Django has never successfully talked to MySQL, and Stages 3-4
  become first-time integration rather than refactoring — **add 2-3 days**.
- Stage 5's number covers code changes only. Any third-party breakage discovered during
  the 2.2 → 3.2 → 4.2 walk is unbudgeted; the dependency list is small, so this is
  unlikely to be large, but it is the least predictable stage.

---

## 1. What's actually running

**Stack:** Django 2.2.28 on Python 3.10.12, gunicorn (1 worker) bound directly to
`173.236.219.130:8000`, WhiteNoise for static files, MySQL `sfev` on
`mysql.whatupsf.com` (MyISAM, utf8mb3). The venv lives outside the repo at
`/home/kriram5/whatupsf.com/venv`.

**Layout:** one Python package, `config/`, is simultaneously the Django *project*
(`settings.py`, `urls.py`, `wsgi.py`) and the only *app* (`models.py`, `forms.py`,
`views/`, `templates/`, `static/`, `fixtures/`). It was renamed from `whatupsf/` →
`config/` in commit `197ef37`; several things still point at the old name (§2.4, §2.16).

**The important structural fact:** there are two independent paths to the same
database, and the ORM is on the path that barely matters.

```
                    ┌─────────────────────── weekly cron (Sun 3am) ────────────────────────┐
                    │  etl/daily_scraper.py  — raw MySQLdb, no ORM                          │
 venue websites ───►│  P1 discover calendar URL  (heuristic → OpenAI → homepage fallback;    │
   (25 venues)      │                             Playwright for JS; PyMuPDF+vision for PDF) │
                    │  P2 parse events           (OpenAI, JSON out)                          │
                    │  P3 band lookup/enrich     (OpenAI + YouTube/SoundCloud scraping)       │
                    │  P4 PURGE + re-insert      ──────────────────────────────► MySQL sfev   │
                    └──────────────────────────────┬────────────────────────────────────────┘
                                                   │ venueETL.dump_latest_info()
                                                   ▼
                                          etl/publish.json  ◄── daily cron 5:59am (--dump-only)
                                                   │                (committed to git)
                    ┌──────────────────────────────┼────────────────────────────────────────┐
                    │  Django  (config/)           │                                         │
                    │   GET /api/map-data.json ────┘  open() + json.load() — NO DB query     │
                    │   GET /                         template + Tailwind CDN + Leaflet      │
                    │   POST /event/ /band/ /venue/    3 ModelForms — the only ORM writes     │
                    └─────────────────────────────────────────────────────────────────────────┘
                                                   │
                                          browser: ES6 modules
                             map-app.js → map-manager · clustering · markers · ui
```

**Read path:** `config/views/map_view.py:15-22` serves `etl/publish.json` straight off
disk. The database is never touched by the map. `publish.json` is the real API contract.

**Write path:** everything meaningful is raw SQL in `etl/`. The ORM's only genuine use
is three `fields = '__all__'` ModelForms.

**Frontend:** server-rendered templates, Tailwind via `cdn.tailwindcss.com`, Leaflet
1.9.4 from unpkg, hand-rolled ES6 modules. No npm, no build step, no lockfile.

**Data model:** 3 live tables (`venues`, `bands`, `events`) plus dead ones (`geoloc`,
`venues_org`, `bands_org`, `events_org`, `auth_message`). No foreign-key constraints
anywhere — MyISAM cannot enforce them. Last recorded run: 1020 events purged, 1014
inserted.

**Scheduled jobs (crontab):**

| Schedule | Job |
|---|---|
| `*/5 * * * *` | gunicorn watchdog — **broken, see §2.4** |
| `59 5 * * *` | `daily_scraper.py --dump-only` (regenerate `publish.json`) |
| `0 3 * * 0` | `daily_scraper.py` (full weekly scrape) |

---

## 2. Technical debt

### Critical

**2.1 — `DEBUG = True` is hardcoded in production.**
`config/settings.py:16` unconditionally overwrites the env-driven value computed one
line above:

```python
DEBUG = os.environ.get("DJANGO_DEBUG", "False").lower() in ("1","true","yes")
DEBUG = True   # line 16 — always wins
```

Any 500 exposes a full traceback with settings, SQL, and environment.

**2.2 — SECRET_KEY is almost certainly the hardcoded default.**
`settings.py:14` falls back to `"dev-insecure-key"`, and `.env` contains only the five
`WHATUPSF_DB_*` vars plus `OPENAI_API_KEY` — no `DJANGO_SECRET_KEY`. Unless it is
exported into gunicorn's environment by hand (not verified), sessions and signed values
are forgeable by anyone who reads this repository.

**2.3 — Django 2.2.28 has been EOL since 2022-04-11.** Four years without security
patches.

### High

**2.4 — The gunicorn watchdog cron is a silent no-op, and wrong on top of that.**

```
*/5 * * * * /bin/bash -c 'cd ... && pgrep -f "gunicorn.*whatupsf" > /dev/null || nohup gunicorn ... whatupsf.wsgi:application &'
```

Two independent failures:

- `pgrep -f` matches the wrapping `/bin/bash -c` process's own command line, which
  contains both `gunicorn` and `whatupsf`. Verified from `/tmp` with no server involved —
  it reports a match regardless. The `||` branch therefore never executes.
- If it ever did execute, it would load `whatupsf.wsgi:application` — a module deleted in
  `197ef37`.

Net effect: **there is no automatic recovery if gunicorn dies.**
(`~/restart_whatupsf.sh` correctly uses `config.wsgi`, so manual restarts work.)

**2.5 — The single source of truth is a non-atomically-written file.**
`venueETL.dump_latest_info` does `open("publish.json","w")` relative to CWD — hence the
`os.chdir()` dances at `daily_scraper.py:1101-1108` and `:1415-1420`. Meanwhile
`map_view.render_json` reads that same path on every request. A request landing mid-write
gets truncated JSON. No temp-file-plus-rename.

**2.6 — Destructive ETL with no real transaction.**
`insert_events` (`daily_scraper.py:1032`) purges *all* events for a venue, then
re-inserts. If the LLM returns an empty or malformed list for a venue, that venue's
events are gone. The `db.rollback()` at `:1077` is decorative — **MyISAM has no
transactions**, so a mid-loop failure leaves the purge permanently applied.

**2.7 — `models.py` re-declares Django's own tables as application models.**
`AuthUser`, `AuthGroup`, `AuthPermission`, `DjangoSession`, `DjangoMigrations`,
`DjangoContentType`, `DjangoAdminLog`, `AuthMessage` (a Django 1.1 relic) are all
`inspectdb` output living in the `config` app alongside `django.contrib.auth`'s real
models. Duplicated identities, polluted ContentTypes, confusing admin.

**2.8 — `ALLOWED_HOSTS` omits the bind IP.**
`gunicorn_error.log` is saturated with `Invalid HTTP_HOST header:
'173.236.219.130:8000'`. Every request over the IP — including `/health/` and whatever
hits `/api/v2/heartbeat` — returns 400. Only `Host: whatupsf.com` works (confirmed
`/health/`, `/`, and `/api/map-data.json` all return 200 with that header).

### Medium

**2.9 — Concrete Django-upgrade blockers.**

| Blocker | Location | Removed in |
|---|---|---|
| `from django.conf.urls import url` | `config/urls.py:1`, used lines 12-21 | Django 4.0 |
| `USE_L10N` | `settings.py:77` | Django 5.0 |
| `django-bootstrap3-datetimepicker==2.2.3` (2015, unmaintained) | `forms.py:1`, only for `ToDoForm` | breaks on 4.x |
| `python-firebase==1.2` — **imported but never used** | `config/views/map_view.py:4` | dead |

**2.10 — `/test/` is routed but structurally broken.**
`config/views/test_view.py` references `venue__id`, `event.band`, `event.price`,
`event.time` — none exist on the unmanaged `Events` model (real fields: `band_id`,
`venue_id`, `event_price`, `event_time`). Dates hardcoded to 2015. Writes `ol.json` into
the server's CWD. Reachable at `config/urls.py:21`.

**2.11 — `/mapper/` is broken.**
`render_map` renders `"index.html"`; the template is at `whatupsf/index.html`. No
root-level `index.html` exists → `TemplateDoesNotExist`.

**2.12 — Zero tests, zero migrations.**
No `migrations/` directory anywhere; the only file matching `test*` is the broken view
above.

**2.13 — Connection-per-query.**
`get_db_connection()` opens and closes a fresh MySQL connection for every band lookup and
every update (`daily_scraper.py:927`, `:1223`, `:1234`, `:1279`) — roughly 1000+
connect/close cycles per run.

**2.14 — Model drift.**
The scraper reads and writes `venues.calendar_url` (`daily_scraper.py:187`, `:198`) but
`config/models.py:189` `Venues` does not declare it. The `inspectdb` snapshot is stale.

**2.15 — Dependencies are split across three places and incomplete.**
`requirements_pip.txt` pins most things but leaves `openai`, `beautifulsoup4`, `lxml`
unpinned; `etl/requirements_pip.txt` contains only `playwright`; and `PyMuPDF`
(`daily_scraper.py:313`) and `geopy` (`venueETL.py:2`) are imported but listed nowhere.

*Unverified:* whether `python-dotenv` is installed in the venv. `settings.py:7-11`
swallows `ImportError` silently, so if it is not, Django never loads `.env` and
`DATABASES['PASSWORD']` falls back to `''`. One command settles it:
`/home/kriram5/whatupsf.com/venv/bin/python3 -m pip show python-dotenv`.
The scraper is immune either way — it hand-parses `.env` at `daily_scraper.py:26-33`.

**2.16 — `MODERNIZATION_COMPLETE.md` documents features that don't exist.**
It marks `modules/filters.js` / `FilterManager` and an entire filter sidebar (date range,
price buckets, venue type) as delivered. Reality: `config/static/js/map-app.js` imports
only `map-manager` and `ui`; `filters.js` survives *only* in `staticfiles/` as stale
pre-rename `collectstatic` output, referenced by nothing; `index.html` has no sidebar.
Its file paths are also all pre-rename (`whatupsf/templates/...`), as is its rollback
procedure. This document will actively mislead the next reader.

**2.17 — Generated artifacts under version control.**
`etl/publish.json` is committed *and* rewritten daily by cron — the working tree is
permanently dirty. Also tracked: `etl/{venues,od,orig_events,new_events,event_master}.json`,
`latlng.csv`. And `.gitignore` misses `etl/.scraper_cache*.json` (183 KB) and `etl/logs/`,
both currently untracked clutter.

**2.18 — Dead and dangerous ETL code.**
`venueETL.py` still carries functions the author marked `#TODO broken`: `get_events` /
`updated_venues` (point at Firebase project `popping-fire-3129`), `setLatLng`
(`geocoders.GoogleV3()` with no API key), and `ingest_bands` (`:238`) which builds SQL by
string interpolation from scraped band names — injection-shaped, though currently
uncalled.

**2.19 — Bare `except:` that silently returns `None`.**
`getListOfAddresses`, `get_latest_info`, `get_json_data`, `get_table_json` all catch
everything, print, and fall through. `get_latest_info` returning `None` makes
`dump_latest_info` write the literal `null` into `publish.json` — a total site blank-out
presenting as success.

**2.20 — The 20-line calendar prompt is copy-pasted and already diverging.**
`parse_events_from_image` (`:340-360`) vs `parse_events_with_ai` (`:644-667`): the text
version has a worked multi-band example and "wine tastings"; the vision version has
neither.

**2.21 — The single-venue CLI path duplicates the pipeline.**
`daily_scraper.py:1337-1411` reimplements the phase-2/phase-3 bodies of
`run_phase2`/`run_phase3` inline. Two copies of the JS-render → PDF-fallback → vision
decision tree to keep in sync.

**2.22 — Frontend supply chain.**
Tailwind's own documentation states the CDN build is not for production; it is unpinned
and JIT-compiles on every page load. Leaflet's CSS has an SRI hash but the JS does not
(`index.html:333`). Cache-busting is a hand-edited query string (`?v=20260216j`).
`no-cache/no-store` meta tags on every page defeat browser caching wholesale.

**2.23 — A 1447-line module.**
`daily_scraper.py` mixes HTTP fetching, HTML cleaning, LLM prompting, regex heuristics,
raw SQL, stdout tee-logging, SMTP alerting, and argparse. `OPENAI_MODEL` is a bare module
constant (`:42`).

---

## 3. Proposed structure

Design principle: **stop pretending the ORM is the data layer, or start actually using
it.** Recommendation is the latter — one schema definition, one query layer, ETL and web
sharing it.

```
whatupsf/
├── pyproject.toml              # single dependency source; replaces 2× requirements_pip.txt
├── .env.example                # + DJANGO_SECRET_KEY, DJANGO_DEBUG, OPENAI_API_KEY, SMTP_*
├── manage.py
│
├── src/whatupsf/
│   ├── settings/
│   │   ├── base.py             # shared
│   │   ├── dev.py              # DEBUG=True lives HERE, nowhere else
│   │   └── prod.py             # fails loudly if SECRET_KEY unset
│   ├── urls.py
│   ├── wsgi.py / asgi.py
│   │
│   ├── events/                 # the domain app
│   │   ├── models.py           # Venue, Band, Event ONLY — managed=True, real FKs
│   │   ├── migrations/         # 0001_initial applied with --fake-initial
│   │   ├── selectors.py        # todays_events() — the one query behind the map
│   │   ├── serializers.py      # owns the publish.json shape
│   │   ├── views.py            # map page + /api/map-data.json (queries DB)
│   │   ├── admin.py            # replaces the three raw ModelForms
│   │   └── tests/
│   │
│   ├── ingest/                 # etl/ decomposed, now a Django app
│   │   ├── management/commands/
│   │   │   ├── scrape_venues.py      # replaces `python etl/daily_scraper.py`
│   │   │   └── publish_snapshot.py   # replaces --dump-only
│   │   ├── fetching.py         # requests + Playwright + retry
│   │   ├── discovery.py        # calendar-URL heuristic / AI / media fallback
│   │   ├── parsing.py          # clean_html, multi-band expansion, non-music filter
│   │   ├── enrichment.py       # band descriptions, media search
│   │   ├── prompts.py          # ONE calendar prompt, ONE enrichment prompt
│   │   ├── llm.py              # client, model config, retry
│   │   ├── pipeline.py         # phase orchestration — single implementation
│   │   └── tests/              # golden-file tests over saved venue HTML
│   │
│   ├── templates/
│   └── static/js/              # unchanged modules; delete stale staticfiles/
│
├── fixtures/sfev.sql
└── docs/
    ├── architecture.md         # rewritten DATABASE_ARCHITECTURE.md
    └── frontend.md             # replaces MODERNIZATION_COMPLETE.md, marked accurate
```

Four changes carry most of the value:

1. **`models.py` shrinks to three managed models with real FKs.** Django's own tables
   come from `django.contrib.*`, not from `inspectdb` output. Migrations exist and are
   `--fake-initial`'d onto the live schema.
2. **The ETL becomes management commands** — same DB config, same logging, same settings
   as the web app, and testable without a live database.
3. **`/api/map-data.json` queries the DB** (cached), instead of reading a file a cron job
   writes. `publish.json` becomes an optional export, not the contract. This alone kills
   §2.5, §2.19, and the `os.chdir` dance.
4. **One prompt module.** Text and vision paths share the calendar prompt so they cannot
   drift.

Keep MySQL, keep server-rendered templates, keep the no-npm frontend. Those are
appropriate for a 25-venue map, and none of the debt above is caused by them.

---

## 4. Refactors ranked by value vs. risk

Risk = chance of breaking the live site. Value = security, reliability, and unblocking
later work.

### Do now — high value, near-zero risk

| # | Refactor | Value | Risk | Why now |
|---|---|---|---|---|
| 1 | Delete `DEBUG = True` (`settings.py:16`); set `DJANGO_DEBUG` in `.env` | Critical | Trivial | One line. Stops leaking tracebacks. |
| 2 | Generate a real `DJANGO_SECRET_KEY`; make prod fail without it | Critical | Trivial | Invalidates sessions once. |
| 3 | Fix the watchdog cron: `pgrep -f "config.wsgi"` (or `pgrep -x gunicorn`), and correct the module name | High | Trivial | Restores crash recovery. Test by killing gunicorn. |
| 4 | Add `173.236.219.130` to `ALLOWED_HOSTS` | High | Trivial | Un-breaks health checks; drains the error log. |
| 5 | Atomic `publish.json` write (temp file + `os.replace`) | High | Trivial | Eliminates torn reads. |
| 6 | Delete `test_view.py` + its route; delete `/mapper/` or fix its template path | Medium | Trivial | Removes two broken endpoints. |
| 7 | Delete the unused `firebase` import (`map_view.py:4`) | Medium | Trivial | Drops an abandoned dependency. |
| 8 | `.gitignore` `etl/.scraper_cache*.json`, `etl/logs/`; `git rm --cached etl/publish.json` | Medium | Trivial | Clean `git status` again. |
| 9 | Rewrite/delete `MODERNIZATION_COMPLETE.md` | Medium | None | It currently misstates shipped features. |

### Do next — high value, moderate risk

| # | Refactor | Value | Risk | Notes |
|---|---|---|---|---|
| 10 | **MyISAM → InnoDB** on `venues`/`bands`/`events` | High | **Medium** | Makes §2.6's rollback real. Needs a verified dump first. Do it alone. |
| 11 | Wrap each venue's purge+insert in one transaction; skip the purge when the parse yields 0 events | High | Low-Med | Depends on #10. Prevents silent data loss. |
| 12 | Consolidate dependencies into `pyproject.toml`; pin everything; add missing `PyMuPDF`/`geopy`; confirm `python-dotenv` | High | Low | Makes the environment reproducible. Resolves §2.15. |
| 13 | Strip auth/django tables from `models.py`; add `calendar_url`; `managed=True`; `makemigrations` + `migrate --fake-initial` | High | Medium | Keystone for the Django upgrade. Verify with `sqlmigrate` first. |
| 14 | Add real FKs (`Event.venue`, `Event.band`) + `select_related` | High | Medium | Follows #10 and #13. |
| 15 | Golden-file tests for `parsing.py` / `discovery.py` over saved venue HTML | High | Low | Prerequisite for touching the scraper safely. |

### Then — the structural work

| # | Refactor | Value | Risk | Notes |
|---|---|---|---|---|
| 16 | Split `daily_scraper.py` into `ingest/` modules; single prompt module; one pipeline (kills §2.20, §2.21, §2.23) | High | Medium | Only after #15. Pure moves, verified per commit. |
| 17 | ETL → management commands; drop the `sys.path` hack and `os.chdir` | Medium-High | Low-Med | Cron switches to `manage.py scrape_venues`. |
| 18 | Point `/api/map-data.json` at the DB via `selectors.py` + cache; demote `publish.json` to an export | High | Medium | Removes the file-as-contract entirely. Compare JSON byte-for-byte before cutover. |
| 19 | Django 2.2 → 4.2 LTS → 5.x: rewrite `url()` → `re_path()`/`path()`, drop `USE_L10N`, replace `django-bootstrap3-datetimepicker` with a native `date`/`datetime-local` input | High | **Medium-High** | Do it *after* #13. 4.2 LTS first, verify, then 5.x. |
| 20 | Replace the three `fields='__all__'` ModelForms with Django admin | Medium | Low | Deletes `forms.py` and `form_view.py` outright. |
| 21 | Connection pooling / one connection per phase | Medium | Low | ~1000 connects per run → a handful. |
| 22 | Tailwind CDN → built CSS; add SRI to Leaflet JS; hashed static filenames via `ManifestStaticFilesStorage` | Medium | Low-Med | Introduces npm. Reasonable to defer. |
| 23 | Drop dead tables/models (`*_org`, `geoloc`, `auth_message`) and dead `venueETL` functions | Low-Med | Low | Do after #18, once nothing reads them. |

### Explicitly not worth it

- **Rewriting the frontend in React/Vue.** A Leaflet map fed by one JSON endpoint is
  exactly right. The existing ES6 modules are fine.
- **Postgres migration.** Real value, but #10 (InnoDB) captures the correctness benefit
  at a fraction of the risk.
- **Async / Celery for the scraper.** It finishes in 9 minutes, once a week.
- **A DRF layer.** One read-only endpoint does not need a framework.

---

## 5. Step-by-step modernization plan

Sequenced so nothing depends on work that has not landed, and every stage ends
deployable.

### Stage 0 — Safety net *(0.5 day; before touching anything)*

1. `mysqldump` all of `sfev`, and **verify the dump restores** into a scratch database.
   Everything after this assumes you can roll back.
2. Stand up a local dev environment against that scratch DB, with its own `.env`.
3. Snapshot the current `/api/map-data.json` response to a file. It is your regression
   oracle for Stage 4.
4. Tag the current commit: `git tag pre-modernization`.

### Stage 1 — Security & reliability *(items 1-9; 0.5 day, no schema changes)*

5. Remove `settings.py:16`. Generate and set `DJANGO_SECRET_KEY`. Add the bind IP to
   `ALLOWED_HOSTS`.
6. Fix the watchdog cron's `pgrep` pattern and wsgi module. **Verify by killing gunicorn
   and confirming it returns within 5 minutes.**
7. Make the `publish.json` write atomic.
8. Delete `test_view.py`, its route, the broken `/mapper/` route, and the `firebase`
   import.
9. Fix `.gitignore`; untrack `etl/publish.json`.
10. Rewrite the two docs to describe what exists. Note explicitly that `filters.js` was
    never wired up.
11. Deploy via `~/restart_whatupsf.sh`. Confirm `/` and `/api/map-data.json` still return
    200 and the error log stops filling with host warnings.

### Stage 2 — Foundations *(items 10, 12, 15; 2 days)*

12. Consolidate dependencies into `pyproject.toml`. Resolve the `python-dotenv` question.
    Rebuild the venv from it and redeploy.
13. Save real HTML from ~6 venues (one static, one JS-rendered, one PDF calendar, one
    multi-band bill, one karaoke/trivia listing, one that currently fails) as test
    fixtures. Write golden-file tests for `clean_html`, `expand_multi_band_events`,
    `is_non_music_act`, and `find_calendar_url_heuristic`. **These must pass before any
    scraper refactor.**
14. Convert the three core tables to InnoDB — on the scratch DB first, then production
    during a window when neither cron runs. Verify row counts and a full scraper run
    afterward.

### Stage 3 — Reclaim the ORM *(items 11, 13, 14, 20; 2-3 days)*

15. Reduce `models.py` to `Venue`, `Band`, `Event`. Delete the eight `Auth*`/`Django*`
    models. Add `Venue.calendar_url`.
16. Flip `managed=True`, `makemigrations`, inspect `sqlmigrate` output, then
    `migrate --fake-initial`. Confirm zero drift with
    `makemigrations --check --dry-run`.
17. Introduce real FKs with `on_delete=PROTECT`. Fix any orphan rows the constraint
    surfaces — worth knowing about either way.
18. Register the three models in `admin.py`; delete `forms.py`,
    `config/views/form_view.py`, the `/event/ /band/ /venue/ /dates/` routes, the
    `forms/` templates, and `django-bootstrap3-datetimepicker`.
19. Add per-venue transactions to the purge/insert, and skip the purge entirely when a
    venue parses to zero events. Run the full scraper against the scratch DB and diff the
    results against a production run.

### Stage 4 — Restructure *(items 16-18, 21; 3-4 days)*

20. Move `config/` → `src/whatupsf/` with a `settings/` package (`base`/`dev`/`prod`).
    Update `manage.py`, `wsgi.py`, `~/restart_whatupsf.sh`, **and all four crontab
    lines.** Deploy and verify before continuing.
21. Split `daily_scraper.py` into the `ingest/` modules. One commit per extraction, tests
    green after each. Collapse the duplicated single-venue CLI path (§2.21) into the
    shared pipeline. Unify the two calendar prompts (§2.20).
22. Convert the entry points to `manage.py scrape_venues` / `manage.py publish_snapshot`;
    delete the `sys.path` hack, the hand-rolled `.env` parser, and both `os.chdir`
    blocks. Swap cron over.
23. Add `events/selectors.py` + `serializers.py`, and repoint `/api/map-data.json` at the
    DB with a short cache. **Diff its output byte-for-byte against the Stage 0
    snapshot** before removing the file read. Keep `publish_snapshot` as an export.
24. Reuse one DB connection per phase.

### Stage 5 — Django upgrade *(item 19; 2 days effort, ~2 weeks elapsed)*

25. `pip install django==3.2` → run `manage.py check --deploy` and the test suite → fix
    warnings → deploy → observe for a few days.
26. Same for **4.2 LTS**. This is where `url()` → `re_path()`/`path()` and dropping
    `USE_L10N` become mandatory. `django-bootstrap3-datetimepicker` is already gone from
    Stage 3, which is why it is no longer a blocker here.
27. Optionally 5.x once 4.2 has been stable for a week. 4.2 LTS is a legitimate resting
    point.

### Stage 6 — Cleanup & frontend *(items 22, 23; 2-3 days, opportunistic)*

28. Drop `venues_org`, `bands_org`, `events_org`, `geoloc`, `auth_message` and the dead
    `venueETL` functions — after confirming via query logs that nothing reads them.
29. Replace bare `except:` with typed handlers that raise rather than returning `None`
    (§2.19).
30. Tailwind CDN → a built stylesheet; add SRI to Leaflet's JS; adopt
    `ManifestStaticFilesStorage` so the manual `?v=` string goes away. Delete the stale
    `staticfiles/` tree, including the orphaned `filters.js`.
31. Either implement the filter sidebar the docs promised, or delete the promise. Do not
    leave it ambiguous a second time.

---

## 6. Open questions

Two items to settle before Stage 2:

- **Is `python-dotenv` installed in the venv?** If not, Django has never loaded `.env`,
  and `DATABASES['PASSWORD']` has been `''` all along — meaning nothing on the Django
  side has ever successfully queried MySQL, and the map works purely because it reads a
  file. That would reframe items 13-18 from "refactor" to "connect for the first time,"
  and adds 2-3 days to the estimate in §0.
  One command: `/home/kriram5/whatupsf.com/venv/bin/python3 -m pip show python-dotenv`.
- **Is there an Apache/nginx proxy in front of gunicorn terminating TLS for
  `whatupsf.com`?** It affects how `ALLOWED_HOSTS`, `SECURE_PROXY_SSL_HEADER`, and
  static-file serving should be configured in Stage 1.
