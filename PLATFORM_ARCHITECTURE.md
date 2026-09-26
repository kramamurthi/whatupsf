# WhatUpSF — Platform Architecture (5-Year Target State)

**Date:** 2026-07-26
**Status:** Design proposal. Greenfield target, not a description of what runs today.
**Companion doc:** `ARCHITECTURE_REVIEW.md` (repairs the current system). This document
answers a different question: *what should exist if WhatUpSF is a platform hosting many
San Francisco applications, not one live-music map?*

---

## 1. Premise

"Platform" is a word that usually costs more than it earns. It earns its keep only if the
Nth application is cheaper than the first. So the design target is a single measurable
property:

> **Adding a new SF application should take days, not months, and should not require
> editing any existing application's code or the core schema.**

Everything below is justified by that sentence. Where a piece of infrastructure does not
make the Nth app cheaper, it is not in the design.

### 1.1 What is actually shared between SF apps?

Not events. Events are WhatUpSF's domain. Imagine the plausible portfolio:

| App | Domain | What it needs |
|---|---|---|
| **Live music** (today) | Venues, shows, artists | places, times, geocoding, map |
| **Street closures & construction** | 311 + SFMTA + DPW permits | places, **line/polygon geometry**, times, map |
| **Food & happy hour** | Restaurants, specials, trucks | places, recurring times, geocoding, map |
| **Development pipeline** | Planning permits, parcels | **parcels**, long time ranges, districts, map |
| **Public art & murals** | Static POIs, walking routes | places, **routing**, map |
| **Transit reliability** | Stops, GTFS-RT | places, **realtime**, map |

Intersect those columns and the shared substrate falls out:

1. **A canonical registry of SF physical locations** with stable IDs.
2. **A time overlay** — things bound to a location and a time window.
3. **Reference geography** — neighborhoods, supervisor districts, parcels, tracts.
4. **Spatial query** — near me, in this viewport, inside this district, within a walk.
5. **Entity resolution & geocoding** — "1015 Folsom" = "1015 Folsom St" = "Folsom Street Foundry".
6. **Ingestion** — fetch → extract → normalize → resolve → validate → publish.
7. **Map delivery** — viewport queries, clustering, tiles, a consistent UI shell.

Six of the seven are geospatial or data-plumbing. Zero are domain-specific. That is the
platform.

### 1.2 The one idea

> **A place graph, a universal time spine, and a spatial index. Applications are layers
> over it, not systems beside it.**

Everything else in this document is mechanism.

### 1.3 Assumptions

- Small team (1–3 engineers). Operational simplicity is a first-class requirement, not a
  compromise.
- Public, read-heavy traffic. Writes are batch ingestion, not user transactions.
- SF-first, but not SF-forever — a `region` key exists from day one because retrofitting
  it in year four is a schema-wide migration (§4.2).
- LLM-based extraction stays central and gets cheaper; source count grows from ~25 to
  hundreds. Provenance and evaluation are therefore load-bearing, not nice-to-have.

---

## 2. Layer model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ L5  DELIVERY                                                                 │
│     app shells (music.whatupsf / streets.whatupsf / …)                       │
│     @wusf/map-kernel  ·  @wusf/design  ·  layer descriptors (per module)      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  GeoJSON / MVT over one versioned API
┌───────────────────────────────┴──────────────────────────────────────────────┐
│ L4  FEATURE MODULES        pluggable, independently ownable, schema-isolated  │
│     music · mobility · food · permits · art · transit                         │
│     each: own DB schema · own API router · own projector · own connectors     │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  ports (typed Python interfaces) — never direct SQL
┌───────────────────────────────┴──────────────────────────────────────────────┐
│ L3  INGESTION PLATFORM                                                        │
│     source registry · connector plugins · run orchestration · staging +       │
│     promotion gates · provenance & lineage · extraction eval harness          │
├──────────────────────────────────────────────────────────────────────────────┤
│ L2  SHARED DOMAIN SERVICES                                                    │
│     enrichment (LLM) · media/assets · taxonomy & tags · text search · alerts  │
├──────────────────────────────────────────────────────────────────────────────┤
│ L1  GEOSPATIAL CORE            ◄── the crown jewel; changes here are rare     │
│     places · aliases & external IDs · entity resolution · geocoding           │
│     geographies (boundary-as-data) · happenings (time spine) · spatial index  │
│     read projections · tile service                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ L0  SUBSTRATE                                                                 │
│     PostgreSQL 16 + PostGIS · object store · queue · cache/CDN · auth ·       │
│     config · observability                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Dependency rule: strictly downward.** L4 modules depend on L1–L3. L1 knows nothing about
music, closures, or permits. A module may not depend on another module — see §10.

---

## 3. Substrate decisions (L0)

| Concern | Choice | Why |
|---|---|---|
| Database | **PostgreSQL 16 + PostGIS 3** | Non-negotiable; §5 is impossible otherwise |
| Runtime | Django 5 LTS (ASGI) | Team knows it; free admin, migrations, auth. The modular design does not depend on Django |
| Queue | Postgres-backed (`SKIP LOCKED`) + Redis cache | One fewer system to run. Kafka buys nothing at this write volume |
| Object store | S3-compatible | Raw HTML/PDF/images for provenance and replay |
| Tiles | MapLibre + MVT generated by `ST_AsMVT` | No separate tile server until a module exceeds ~10⁵ features |
| Deploy | 4 process types, one image | §12 |

**Postgres+PostGIS is the single most consequential decision here.** It provides, in one
system: geometry types and a GiST index; `ST_DWithin` KNN search; `ST_Contains` for
boundary assignment; `ST_ClusterDBSCAN` for server-side clustering; `ST_AsMVT` for vector
tiles; `tstzrange` + `btree_gist` for *combined space-time indexing*; JSONB for
heterogeneous source payloads; schemas for module isolation; and table partitioning for
time-series growth. Rejected alternatives in §14.

---

## 4. The geospatial core (L1)

Three tables carry the platform. Everything else is commentary.

### 4.1 `core.place` — the universal join key

Every physical thing in San Francisco that anything might attach to: a venue, a
restaurant, a park, an intersection, a parcel, a transit stop, a mural.

```sql
CREATE SCHEMA core;
CREATE EXTENSION postgis;
CREATE EXTENSION btree_gist;

CREATE TABLE core.place (
  id              text PRIMARY KEY DEFAULT gen_ulid(),
  region_id       text        NOT NULL REFERENCES core.region(id) DEFAULT 'sf',
  kind            text        NOT NULL REFERENCES core.place_kind(code),
  canonical_name  text        NOT NULL,
  geom            geometry(Point, 4326)        NOT NULL,
  footprint       geometry(MultiPolygon, 4326),          -- parcels, parks, campuses
  address_line    text,
  postal_code     text,
  status          text        NOT NULL DEFAULT 'active', -- active|closed|provisional|merged
  merged_into     text        REFERENCES core.place(id), -- dedup without breaking FKs
  confidence      real        NOT NULL DEFAULT 1.0,
  attrs           jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX place_geom_gix ON core.place USING GIST (geom);
CREATE INDEX place_live_ix  ON core.place (region_id, kind) WHERE status = 'active';
```

Two satellite tables make it a *graph* rather than a list, and they are what make entity
resolution tractable:

```sql
-- every name any source has ever used for this place
CREATE TABLE core.place_alias (
  place_id   text NOT NULL REFERENCES core.place(id) ON DELETE CASCADE,
  name       text NOT NULL,
  normalized text NOT NULL,                       -- casefold, strip punctuation/"the"
  source_id  text REFERENCES ingest.source(id),
  PRIMARY KEY (place_id, normalized)
);
CREATE INDEX place_alias_trgm ON core.place_alias USING GIN (normalized gin_trgm_ops);

-- the anchor: an ID in someone else's namespace
CREATE TABLE core.place_external_id (
  namespace   text NOT NULL,      -- 'datasf.parcel' | 'google.place' | 'osm.node' | 'eventbrite.venue'
  external_id text NOT NULL,
  place_id    text NOT NULL REFERENCES core.place(id) ON DELETE CASCADE,
  PRIMARY KEY (namespace, external_id)
);
```

**Why this shape.** Modules never mint their own location records. `music.performance`,
`mobility.closure`, and `permits.application` all carry a `place_id`. The moment two apps
reference the same `place_id`, cross-app questions become one join instead of a fuzzy
address match — and "is there construction outside the venue I'm going to tonight?"
becomes a query rather than a project.

`merged_into` matters more than it looks: duplicate places are inevitable with LLM
extraction, and a merge that rewrites foreign keys is a data-loss event. Tombstone and
redirect instead.

### 4.2 `region_id` from day one

`'sf'` today. Adding Oakland in year four is then a data load; without it, it is a
migration across every table in the system. This is the cheapest option in the entire
document and the most expensive to add late.

### 4.3 `geo.*` — boundaries as data, not code

Nobody should ever write `NEIGHBORHOODS = ["Mission", "SoMa", ...]` in Python again.

```sql
CREATE SCHEMA geo;

CREATE TABLE geo.layer (                  -- 'neighborhood', 'supervisor_district',
  code        text PRIMARY KEY,           -- 'police_district', 'zipcode', 'census_tract',
  title       text NOT NULL,              -- 'parcel', 'transit_walkshed'
  source_url  text,
  updated_at  timestamptz
);

CREATE TABLE geo.boundary (
  id          bigserial PRIMARY KEY,
  layer_code  text NOT NULL REFERENCES geo.layer(code),
  code        text NOT NULL,              -- 'D9', '94110'
  name        text NOT NULL,              -- 'Mission'
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  valid_from  date NOT NULL DEFAULT '-infinity',
  valid_to    date NOT NULL DEFAULT  'infinity',
  attrs       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX boundary_gix ON geo.boundary USING GIST (geom);
```

Adding *supervisor districts*, *SFUSD attendance zones*, or *liquor license zones* is a
shapefile load and one `geo.layer` row. **Zero code.**

`valid_from`/`valid_to` are not decoration. SF redistricted supervisor districts in 2022
and will again after the 2030 census — inside this document's five-year horizon. A
platform that stores "which district is this venue in?" as a single mutable answer will
silently rewrite history the day the boundaries change.

**Denormalize the answer, because point-in-polygon at query time does not scale:**

```sql
CREATE TABLE core.place_geography (
  place_id    text NOT NULL REFERENCES core.place(id) ON DELETE CASCADE,
  layer_code  text NOT NULL,
  boundary_id bigint NOT NULL REFERENCES geo.boundary(id),
  PRIMARY KEY (place_id, layer_code)
);
```

Maintained by trigger on place insert/move, and by a backfill job on boundary reload.
"Every music venue in District 9" becomes an index lookup.

### 4.4 `core.happening` — the universal time spine

The design's second real decision, and the one that most constrains the future.

**Should each module own its own events table, or is there one shared temporal entity?**
Shared. The single most valuable thing a multi-app SF platform can answer is *"what is
happening near me, right now, across everything"* — and that question is unanswerable if
music shows, street closures, and food pop-ups live in three unrelated tables with three
different time representations.

The resolution is a **thin universal spine plus per-module detail tables** — enough shared
structure to query across modules, no shared structure that forces domains to distort.

```sql
CREATE TABLE core.happening (
  id          text PRIMARY KEY DEFAULT gen_ulid(),
  module      text NOT NULL REFERENCES core.module(code),
  kind        text NOT NULL,                       -- 'music.performance', 'mobility.closure'
  place_id    text REFERENCES core.place(id),
  geom        geometry(Geometry, 4326),            -- override: closures are LINESTRINGs,
                                                   -- festivals POLYGONs. NULL ⇒ use place.geom
  during      tstzrange NOT NULL,
  starts_at   timestamptz GENERATED ALWAYS AS (lower(during)) STORED,
  all_day     boolean NOT NULL DEFAULT false,
  rrule       text,                                -- RFC 5545, for recurring happenings
  title       text NOT NULL,
  summary     text,
  status      text NOT NULL DEFAULT 'scheduled',   -- scheduled|cancelled|postponed|ended
  url         text,
  tags        text[] NOT NULL DEFAULT '{}',
  source_id   text REFERENCES ingest.source(id),
  confidence  real,
  attrs       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- combined space+time index — the hot path for every app
CREATE INDEX happening_st_gix ON core.happening USING GIST (geom, during);
CREATE INDEX happening_mod_ix ON core.happening (module, starts_at);
CREATE INDEX happening_tag_ix ON core.happening USING GIN (tags);
```

`btree_gist` is what allows a *single* index to serve `WHERE ST_DWithin(...) AND during &&
tstzrange(...)`. That combination is the platform's most-executed query; it deserves its
own index rather than two index scans and a bitmap AND.

Modules extend by 1:1 table, never by adding columns to core:

```sql
CREATE SCHEMA music;
CREATE TABLE music.performance (
  happening_id   text PRIMARY KEY REFERENCES core.happening(id) ON DELETE CASCADE,
  artist_id      text REFERENCES music.artist(id),
  billing_order  smallint NOT NULL DEFAULT 0,   -- headliner=0 — multi-band bills, cleanly
  door_time      time,
  price_min      numeric(7,2),
  price_max      numeric(7,2),
  age_limit      text
);

CREATE SCHEMA mobility;
CREATE TABLE mobility.closure (
  happening_id   text PRIMARY KEY REFERENCES core.happening(id) ON DELETE CASCADE,
  permit_number  text,
  closure_type   text,        -- construction|event|emergency|filming
  affected_lanes smallint,
  detour_geom    geometry(MultiLineString, 4326)
);
```

**Scaling note.** Leave `core.happening` unpartitioned until it passes roughly 10⁷ rows.
When it does, partition by range on `starts_at` (already a stored generated column for
exactly this reason); the primary key becomes `(id, starts_at)`. Designing the column in
now costs nothing; partitioning now costs operational complexity for no benefit.

### 4.5 Entity resolution — the highest-risk shared capability

If this is mediocre, the place graph fragments into near-duplicates and every cross-app
promise in this document silently fails. It gets a real service, not a helper function.

```
                    ┌─────────────────────────────────────────────┐
 RawRecord          │  core.resolve(name, address?, geom?, ns/id?) │
 (name, address) ──►│                                              │
                    │  1. exact external_id  (namespace, id)       │  ← free, authoritative
                    │  2. exact normalized alias + within 150 m    │  ← cheap, high precision
                    │  3. trigram name similarity + within 300 m   │  ← pg_trgm + GiST KNN
                    │  4. address normalization → geocode → 40 m   │  ← libpostal + Nominatim
                    │  5. LLM adjudication (top-3 candidates)      │  ← expensive, last resort
                    │  6. create provisional place, flag for review│
                    └──────────────────┬──────────────────────────┘
                                       ▼
                     (place_id, confidence, method, candidates[])
```

Three properties matter more than the ladder itself:

- **Every decision is recorded** in `core.resolution_log` with method, score, and rejected
  candidates. Tuning without a labelled history is guesswork.
- **Low confidence creates a `provisional` place, never a silent merge.** Wrong merges are
  far more expensive to undo than duplicates.
- **A human review queue exists in Django admin from day one.** Two minutes a week beats a
  cleverer algorithm.

---

## 5. Geospatial capabilities offered to modules

Exposed as a typed Python port (`core.geo.ports`) and as HTTP. No module writes PostGIS
SQL directly.

| Capability | Signature | Implementation |
|---|---|---|
| Viewport query | `features_in_bbox(bbox, when, modules, tags, limit)` | GiST on `read.map_feature` |
| Proximity | `nearest(point, kind, k, max_m)` | KNN `<->` operator |
| Radius | `within(point, radius_m, when)` | `ST_DWithin` on geography |
| Containment | `places_in(layer, code)` | `core.place_geography` lookup |
| Reverse geography | `geographies_for(point, at_date)` | `ST_Contains` + temporal filter |
| Clustering | `cluster(bbox, zoom, modules)` | `ST_ClusterDBSCAN`, eps by zoom |
| Tiles | `mvt(module, z, x, y)` | `ST_AsMVT` + `ST_AsMVTGeom` |
| Isochrone | `walkshed(point, minutes)` | Valhalla sidecar (deferred to Y3) |
| Geocode | `geocode(address)` / `reverse(point)` | libpostal + Nominatim + cache |
| Route | `route(a, b, mode)` | Valhalla (deferred; art-walk module) |

**Rule: any capability at least two modules need moves here.** The first module to need
walksheds builds it *inside* the geospatial core, behind this interface — never in its own
namespace. That single rule is most of what keeps the platform from becoming a folder of
apps.

---

## 6. Ingestion platform (L3)

The current scraper's real lesson: the hard parts (JS rendering, PDF calendars, LLM
extraction, retries, caching) are **domain-independent**, and today they are welded to
live-music logic. Invert that.

### 6.1 Sources are rows, not code

```sql
CREATE SCHEMA ingest;

CREATE TABLE ingest.source (
  id          text PRIMARY KEY,           -- 'music.august_hall'
  module      text NOT NULL REFERENCES core.module(code),
  connector   text NOT NULL,              -- 'web_calendar' | 'socrata' | 'gtfs_rt' | 'ics' | 'arcgis'
  config      jsonb NOT NULL,             -- connector-specific: url, dataset id, selectors
  schedule    text NOT NULL,              -- cron
  trust_tier  smallint NOT NULL DEFAULT 2,-- 1 authoritative(DataSF) 2 curated 3 scraped
  enabled     boolean NOT NULL DEFAULT true,
  place_id    text REFERENCES core.place(id),   -- for single-place sources
  last_run_at timestamptz
);
```

Onboarding a venue, a DataSF dataset, or a GTFS feed is an INSERT. The scheduler reads
this table; nothing is hardcoded.

### 6.2 Connectors are plugins

```python
class Connector(Protocol):
    code: str
    config_schema: type[BaseModel]

    def discover(self, cfg) -> Iterable[DocumentRef]: ...   # find the calendar page / dataset slice
    def fetch(self, ref) -> Document: ...                   # HTTP/Playwright/PDF → bytes + content_hash
    def extract(self, doc) -> Iterable[RawRecord]: ...      # → normalized dicts
```

Shipped connectors: `web_calendar` (the current scraper, generalized), `socrata`
(DataSF — 311, permits, closures), `arcgis`, `gtfs_static`, `gtfs_rt`, `ics`, `rss`,
`csv_drop`, `manual`. A module contributes connectors; the runtime supplies everything
after `extract`.

### 6.3 One pipeline, staged, with a promotion gate

```
discover → fetch → [object store + content_hash] → extract → normalize
   → resolve (§4.5) → validate → STAGE → ✋ promotion gate → publish → project
```

`ingest.staged_record` holds the run's output. Nothing touches live tables until the gate
passes:

| Gate | Rule | Rationale |
|---|---|---|
| Volume | reject if count < 40% of trailing 5-run median | An empty LLM response must never mean "this venue closed" |
| Geometry | 100% of records resolve inside the region envelope | Catches lat/lng swaps and geocoder failures |
| Schema | every record validates against the module's Pydantic model | |
| Confidence | mean extraction confidence ≥ source's floor | |
| Drift | ≤ 30% of records changed vs. last run, unless flagged | Catches silent site redesigns |

Publish is a **transactional upsert diffed against the previous run**, never
purge-and-reinsert. Records absent from a passing run are marked `status='ended'`, not
deleted — which preserves history and makes "what was on last Friday?" answerable.

This is the current destructive-ETL problem solved *structurally*: no amount of downstream
carefulness fixes an architecture where the write path can only replace everything.

### 6.4 Provenance is mandatory

Every published row carries `source_id`, and every run writes `ingest.run` +
`ingest.document` (with the raw bytes in object storage, keyed by content hash). Given any
feature on the map, you can retrieve the exact HTML, the exact prompt, the model version,
and the extraction confidence that produced it.

With LLM extraction this is not an audit nicety — it is the only way to debug a wrong
answer, and the only way to build the eval sets in §7.

---

## 7. Enrichment service (L2)

LLM calls are a shared capability with real cost and real failure modes. Today prompts are
string literals that have already diverged between two call sites. Centralize:

```python
result = enrichment.extract(
    task="calendar.events.v4",        # versioned template from the registry
    document=doc,                     # text, HTML, or image
    schema=CalendarExtraction,        # Pydantic → structured output
    budget=Budget(usd=0.05, ms=30_000),
)
```

- **Prompt registry** — versioned, reviewable, one definition per task. Text and vision
  paths share the same template; divergence becomes structurally impossible.
- **Response cache** keyed by `(task_version, model, content_hash)`. Re-running a pipeline
  after a code change costs nothing.
- **Structured output** everywhere; schema violations retry, then fail the record — never
  silently produce `null`.
- **Eval harness** — golden fixtures per source class (static HTML, JS-rendered, PDF
  calendar, multi-band bill, non-music listing, known-hard site). Prompt or model changes
  run against it in CI. **A prompt change without an eval run is a deploy without a test.**
- **Cost accounting** per source and per module, surfaced in the admin.

Model selection is config, not code: default to the current Claude Opus tier for hard
extraction, a cheaper tier for classification, chosen per task in the registry.

---

## 8. Read models and the public API

### 8.1 Projections

Applications never query write tables. A projector maintains one denormalized,
map-ready table:

```sql
CREATE SCHEMA read;
CREATE TABLE read.map_feature (
  id           text PRIMARY KEY,          -- happening or place id
  module       text NOT NULL,
  kind         text NOT NULL,
  region_id    text NOT NULL,
  geom         geometry(Geometry, 4326) NOT NULL,
  during       tstzrange,
  title        text NOT NULL,
  subtitle     text,
  tags         text[] NOT NULL DEFAULT '{}',
  props        jsonb NOT NULL,            -- module-specific display payload
  rank         real  NOT NULL DEFAULT 0,  -- for zoom-dependent thinning
  updated_at   timestamptz NOT NULL
);
CREATE INDEX map_feature_st_gix ON read.map_feature USING GIST (geom, during);
CREATE INDEX map_feature_mod_ix ON read.map_feature (module, region_id);
```

Each module supplies a `Projector` that turns its rows into `map_feature` rows. Benefits:
one hot path to index, cache, and CDN; the API shape stops being coupled to storage; a
module can restructure its private schema without breaking a single client.

### 8.2 API surface

```
GET /v1/features?bbox=&from=&to=&modules=&tags=&limit=      → GeoJSON FeatureCollection
GET /v1/tiles/{module}/{z}/{x}/{y}.mvt                      → Mapbox Vector Tile
GET /v1/places/{id}                                         → place + attached happenings
GET /v1/places?near=lng,lat&radius=&kind=                   → GeoJSON
GET /v1/geographies/{layer}[?at=YYYY-MM-DD]                 → boundary GeoJSON (temporal)
GET /v1/geographies/{layer}/{code}/features?...             → everything in a district
GET /v1/modules                                             → capability discovery
```

Design rules:

- **GeoJSON is the lingua franca.** Every geometry-bearing response is valid GeoJSON, so
  any mapping client works without a translation layer.
- **`modules` is a filter, never a path segment.** `?modules=music,mobility` is what makes
  the cross-app map possible. Namespacing apps into `/v1/music/...` would foreclose it.
- **One version, additive changes.** `/v2` only for a breaking change, with `/v1` retained
  for two quarters.
- **Cache-Control at the edge**, keyed by rounded bbox + time bucket. A viewport query is
  the most repeated request in the system.

REST + GeoJSON over GraphQL: the query shape is narrow and spatial, edge caching is
trivial, and GraphQL's flexibility buys nothing when 95% of traffic is one viewport query.

---

## 9. Frontend architecture (L5)

### 9.1 Map kernel + layer descriptors

```
packages/
  map-kernel/      viewport→query, debounce/abort, clustering, selection, URL state,
                   time scrubber, geolocation, keyboard nav, a11y, offline cache
  design/          tokens, components, dark mode, typography
  api-client/      generated from the OpenAPI spec; typed
apps/
  music/  streets/  food/  explore/      ← thin shells
modules/
  music/layer.ts   streets/layer.ts      ← one descriptor per module
```

A module joins the map by exporting a descriptor:

```ts
export const musicLayer: LayerModule = {
  id: "music",
  title: "Live Music",
  source: { endpoint: "/v1/features", params: { modules: "music" } },
  cluster: { maxZoom: 15, radius: 60 },
  style: (f) => ({ icon: "note", color: tokens.accent.violet, size: f.properties.rank }),
  popup: (f) => <PerformanceCard feature={f} />,
  filters: { price: "range", genre: "multi", startsWithin: "duration" },
  legend: { swatches: [...] },
};
```

**Adding an app's layer to the unified map is one file.** The kernel owns every hard
part — viewport math, request cancellation, cluster stability across zooms, the
back-button, screen-reader announcements for a canvas map — and it is written once.

The `explore` shell registers *all* descriptors and is the cross-app product: "what's
happening near me tonight," music and street closures and food together.

### 9.2 Rendering

MapLibre GL + vector tiles once any module exceeds a few thousand simultaneous features;
Leaflet + GeoJSON is a legitimate resting point below that. The kernel abstracts the
renderer so the swap is one package, not every app.

---

## 10. The module contract

This section is the extensibility guarantee. It is short on purpose — a contract nobody
can recite is not enforced.

### 10.1 A module declares itself

```python
@register_module
class MusicModule(FeatureModule):
    code = "music"
    schema = "music"                       # owns exactly this Postgres schema
    happening_kinds = [KindSpec("music.performance", label="Show", icon="note")]
    connectors = [WebCalendarConnector, EventbriteConnector]
    projector = MusicProjector
    api_router = music_router              # mounted at /v1/modules/music/*
    admin = MusicAdmin
```

Discovered via Python entry points. **Installing a module is `pip install` + one migration
+ one `core.module` row.** No core file is edited to add an app.

### 10.2 The four rules

1. **A module owns exactly one Postgres schema** and creates tables nowhere else.
2. **A module may read `core.*`, `geo.*`, `read.*`** — through published ports, not
   handwritten SQL.
3. **A module may never read or write another module's schema.** Not once, not "just this
   one join."
4. **Cross-module needs resolve one of two ways:** promote the concept into core (if it is
   genuinely universal), or subscribe to the other module's outbox events (if it is not).

### 10.3 Enforcement — because rules decay

- **Database grants.** Each module's connection role has USAGE on `core`, `geo`, `read`,
  and its own schema. Rule 3 fails at the database, not at review.
- **CI import check.** An AST test asserts no `modules.music.*` import appears outside
  `modules/music/`.
- **Migration lint.** A module's migrations may only touch its own schema.

### 10.4 The extraction path

Because a module already has its own schema, its own role, its own queue topics, and no
inbound dependencies, promoting it to a separate service is: point it at its own database
(or a logical replica of `core`), swap its port implementations for HTTP clients, deploy
separately. Nothing else changes.

**We do not do this on day one.** We make it a two-week job instead of a two-quarter one,
and then only do it when a module's traffic or team ownership actually demands it.

---

## 11. Worked example — adding "SF Street Closures"

The design's actual test. Every step below touches *new* files plus registry rows.

| Day | Work | Files touched |
|---|---|---|
| 1 | `pip install`-able package skeleton; `MobilityModule` declaration; migration creating `mobility` schema with `mobility.closure` | all new |
| 1 | Register the `socrata` connector against DataSF's street-closure dataset — **already exists**, built for permits | 1 INSERT into `ingest.source` |
| 2 | Extraction mapping: dataset columns → `RawRecord`; geometry is LINESTRING, so `happening.geom` is set and `place_id` is left null | new, ~80 lines |
| 2 | Resolution: closures reference intersections → `core.resolve` with `namespace='datasf.cnn'` | 0 (core capability) |
| 3 | `MobilityProjector` → `read.map_feature` | new, ~40 lines |
| 3 | `mobilityLayer` descriptor: red LINESTRING styling, closure popup, date-range filter | new, 1 file |
| 4 | Golden-fixture tests + promotion-gate thresholds | new |
| 5 | Ship: `/v1/features?modules=mobility` live; layer appears in `explore` alongside music | 1 INSERT into `core.module` |

**Zero changes to `core`, zero changes to the music module, zero API version bump.**

And the payoff falls out for free, because both apps share `core.place` and
`core.happening`:

```sql
-- "Shows tonight with construction within 200m" — no new infrastructure
SELECT h.title, p.canonical_name, c.title AS closure
FROM   core.happening h
JOIN   core.place     p ON p.id = h.place_id
JOIN   core.happening c ON c.module = 'mobility'
                       AND c.during && h.during
                       AND ST_DWithin(c.geom::geography, p.geom::geography, 200)
WHERE  h.module = 'music' AND h.during && tstzrange(now(), now() + interval '12 hours');
```

That query is the entire argument for the platform. It is one join because §4.1 and §4.4
made it one join.

---

## 12. Runtime topology

```
                    CDN  (edge cache: /v1/features, /v1/tiles)
                     │
              ┌──────┴───────┐
              │  web (ASGI)  │  ×N   API + app shells + admin
              └──────┬───────┘
   ┌─────────────────┼──────────────────┬───────────────────┐
   │                 │                  │                   │
┌──┴────────┐  ┌─────┴──────┐   ┌───────┴──────┐   ┌────────┴────────┐
│ scheduler │  │  ingest    │   │  projector   │   │  enrichment     │
│ (cron ←   │  │  workers   │   │  workers     │   │  workers        │
│  sources) │  │  ×N        │   │  (outbox →   │   │  (LLM, rate-    │
└───────────┘  └─────┬──────┘   │   read.*)    │   │   limited pool) │
                     │          └──────┬───────┘   └────────┬────────┘
              ┌──────┴─────────────────┴────────────────────┴──────┐
              │   PostgreSQL 16 + PostGIS   ·   Redis   ·   S3      │
              └────────────────────────────────────────────────────┘
```

Four process types, one container image, one database. This is deliberately boring: a
small team's scarcest resource is operational attention, and the modularity above is
enforced by schemas, roles, and CI rather than by network boundaries.

Separate worker pools matter for one concrete reason: a slow LLM extraction must never
delay a projection, and a projection backlog must never delay serving.

---

## 13. Cross-cutting concerns

**Identity.** One account across apps (`core.user`), anonymous read by default.
Authenticated features — saved places, alert subscriptions, contributions — are per-module
capabilities on a shared identity. Per-module admin roles from the start; contributor
roles by Y3.

**Authorization.** Public read of published data; module-scoped write via API keys for
ingestion; RLS on user-owned rows (saved places, alerts). Keep this simple until a module
genuinely needs more.

**Observability.** Trace ID propagated from HTTP request through queue message to LLM call.
Per-module dashboards: ingest freshness, gate rejections, resolution confidence
distribution, viewport p95, LLM spend. **Data freshness is the SLI that actually matters** —
a fast site serving last month's shows is a broken site.

**Configuration.** Twelve-factor; secrets from the environment; production fails to boot
on a missing secret rather than falling back to a default.

**Testing.** Unit tests per module; golden-fixture tests per connector; contract tests
against the OpenAPI spec; one end-to-end per module (source row → gate → projection →
`/v1/features`).

---

## 14. Decisions and rejected alternatives

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| 1 | Spatial store | Postgres + PostGIS | MySQL spatial; Mongo geo; Elasticsearch | Only PostGIS gives KNN + MVT + DBSCAN + range-and-geometry in one index |
| 2 | Service granularity | Modular monolith, schema-isolated | Microservices | Team of 1–3. Network boundaries add failure modes without adding modularity; §10.4 keeps extraction cheap |
| 3 | Data isolation | Shared DB, schema + role per module | Database per module | Cross-module spatial joins (§11) are the product. Distributed joins would destroy it |
| 4 | Temporal model | Universal `happening` spine + module detail tables | Per-module event tables | "What's near me now, across everything" is the platform's reason to exist |
| 5 | Geography | Boundary rows with validity ranges | Hardcoded lists; PostGIS-only lookups | New layer = shapefile load. Redistricting doesn't rewrite history |
| 6 | Read path | Projected `read.map_feature` | Query-time joins; file snapshots | One hot path to index and cache; decouples API shape from storage |
| 7 | API | REST + GeoJSON/MVT | GraphQL federation | Narrow query shape; edge-cacheable; every map client speaks GeoJSON |
| 8 | Queue | Postgres `SKIP LOCKED` | Kafka; SQS | Write volume is batch and modest. One fewer system to operate |
| 9 | Ingestion | Declarative source registry + connector plugins | Per-source scripts | Onboarding a source is an INSERT. This is the current design's core failure |
| 10 | Write semantics | Staged + gated diff-upsert | Purge and reinsert | An empty extraction must never be able to delete real data |
| 11 | Rendering | MapLibre + MVT (Leaflet until needed) | Leaflet forever; Google Maps | Vector tiles are required past ~10⁴ features; renderer sits behind the kernel |
| 12 | Multi-region | `region_id` from day one | Add later | Cheapest line in this document now; a full migration later |
| 13 | LLM usage | Central versioned prompt registry + evals | Inline prompts per module | Prompts are shared infrastructure with cost and drift; today's have already diverged |

---

## 15. Fitness functions

Architecture without automated enforcement is documentation. These run in CI and fail the
build:

1. **No cross-module imports** — AST scan.
2. **No cross-schema SQL** — DB grants make it impossible; a test asserts the grants.
3. **Migrations stay in their schema** — migration lint.
4. **API contract** — every `/v1` response validates against the OpenAPI spec and against
   the GeoJSON schema.
5. **Viewport p95 < 150 ms** at 100k seeded features, measured on every build.
6. **Provenance completeness** — 100% of `read.map_feature` rows trace to an `ingest.run`.
7. **Extraction quality** — per-source golden fixtures; prompt/model changes must not
   regress F1.
8. **Time-to-new-module** — the scaffold generator produces a module that passes an
   end-to-end test in under an hour. Measured quarterly; regression means the core has
   leaked domain knowledge.

Number 8 is the one that matters most. It is the premise in §1 turned into a test.

---

## 16. Five-year phasing

| Phase | Focus | Exit criterion |
|---|---|---|
| **Y1 H1 — Foundation** | PostGIS; `core.place`/`geo`/`core.happening`; entity resolution; music re-landed as the first module | WhatUpSF serves from `/v1/features`; `publish.json` retired |
| **Y1 H2 — Ingestion platform** | Source registry; `web_calendar` + `socrata` connectors; staging + gates; enrichment registry + evals | A new music source is an INSERT; DataSF ingestion works |
| **Y2 — The second app** | Mobility (street closures); map kernel extracted; MVT tiles; `explore` cross-module shell | Second app shipped in ≤ 2 weeks (the real proof) |
| **Y3 — People** | Accounts, saved places, alerts, notifications; third app (food or permits); walkshed/routing | Cross-module personalized alerts live |
| **Y4 — Scale & openness** | Partitioning, read replicas, tile CDN; public API keys; first external module | A third party ships a module without core changes |
| **Y5 — Reach** | Second region; partner data; possible module extraction where warranted | `region_id = 'oak'` is a data load, not a migration |

**The Y2 exit criterion is the honest test.** If the second app takes two months instead of
two weeks, the abstractions in §4 are wrong and should be revised before a third app
compounds the error.

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Entity resolution underperforms** | Place graph fragments; every cross-app promise fails silently | Provisional places, never silent merges; human review queue from day one; labelled resolution log |
| **`core.happening` is wrong for app #3** | Core schema change; all modules churn | Keep the spine *thin*; everything domain-specific goes in `attrs` or the extension table. Revisit deliberately after Y2 |
| **Platform built for apps that never ship** | Months spent on abstraction with one consumer | Build core capabilities only when the *second* consumer appears; §5's rule cuts both ways |
| **Module discipline erodes** | Monolith with extra steps | §15 fitness functions; DB grants make the worst violation impossible |
| **LLM cost scales with source count** | Ingestion becomes the dominant expense | Content-hash cache; cheapest-model-per-task; prefer structured sources (Socrata) over scraping; per-source budgets |
| **Single database is the coupling point** | One bad query degrades every app | Per-module roles with statement timeouts and connection caps; read replicas by Y4 |
| **Bad ingest data reaches production** | Wrong info on a public map | Promotion gates; drift detection; every feature traceable to source bytes |

---

## 18. Getting from here to there

Detail belongs in `ARCHITECTURE_REVIEW.md`; the strangler sequence is short:

1. **Stabilize** — the Stage 0/1 security and reliability work. Do not build a platform on
   a system that leaks tracebacks and cannot restart itself.
2. **Stand `core` up beside the current system.** New Postgres+PostGIS instance. Load
   `geo` boundaries from DataSF. Migrate 27 venues → `core.place`, backfilling
   `place_external_id` and aliases. Nothing in production changes.
3. **Dual-write.** The existing scraper additionally writes `core.happening` +
   `music.performance`. Diff the two datasets daily until they agree.
4. **Cut the read path.** `/v1/features` replaces `publish.json`; the existing frontend
   consumes GeoJSON. Byte-compare before cutover. **This is the point of no return, and
   also the point where the file-as-contract problem disappears.**
5. **Rebuild ingestion as connectors** behind the source registry, one venue class at a
   time, with golden fixtures gating each move.
6. **Delete MySQL** and the old ETL.
7. **Build the second app** — and find out whether any of this was right.

Steps 1–4 are worth doing regardless of whether the platform thesis holds; they are the
right architecture for a single well-built map. The platform bet only starts at step 7.

---

## Appendix A — Schema map

```
core/     region · place · place_kind · place_alias · place_external_id
          place_geography · resolution_log · happening · module · user · event_outbox
geo/      layer · boundary
ingest/   source · run · document · staged_record · gate_result
read/     map_feature · place_card
music/    artist · performance · venue_profile
mobility/ closure · permit
food/     establishment · special · truck_appearance
permits/  application · parcel_link
```

## Appendix B — What we deliberately do not build

- **Microservices, Kubernetes, service mesh** — §14.2.
- **A custom tile server** — `ST_AsMVT` covers this until well past current scale.
- **Realtime everything** — transit GTFS-RT is the only genuinely realtime source; it gets
  a dedicated fast path, not a platform-wide push architecture.
- **A recommendation engine** — before there are users, saved places, and three apps, it
  has nothing to learn from.
- **Our own geocoder** — libpostal for parsing plus a hosted geocoder, cached forever.
  Revisit only if cost or coverage forces it.
- **Multi-tenancy for other cities' operators** — `region_id` keeps the door open; the
  product complexity is not worth carrying now.
