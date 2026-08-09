#!/usr/bin/env python3
"""
Ingest the Outside Lands schedule from the festival's own JSON API.

Why this exists instead of the generic scraper
----------------------------------------------
daily_scraper cannot do this job, for two structural reasons:

  1. All three festival days live at one URL behind a client-side filter
     (/schedule/#/schedule_groupings/saturday/). A hash fragment triggers no
     server request, so a fetch always lands on the default day. Every act got
     stamped with today's date regardless of when it actually plays.

  2. All eight stages are rendered on that same page. Asking an LLM for "events
     at Sutro Stage" hands it the whole festival and hopes it picks the right
     slice — which it did not: one run returned another stage's lineup, another
     merged several stages, another gave seven acts the same start time.

The page is driven by a JSON API that already carries the stage and a
timezone-correct ISO start on every show, so none of that guessing is needed.
Endpoint and headers were read off the page's own network traffic; the two
ds-* headers are required or the API answers 404 "missing proper headers".

Usage:
    python osl_ingest.py --dry-run     # show what would be written
    python osl_ingest.py               # write to DB, then refresh publish.json
"""
import argparse
import json
import sys
import urllib.request
from collections import defaultdict

from daily_scraper import lookup_or_create_band, insert_events
from venueETL import dump_latest_info

API = 'https://api.dostff.co/api/v1/schedule_groupings/{gid}'
HEADERS = {
    'accept': 'application/json',
    'ds-property-id': '157',            # Outside Lands
    'ds-property-type': 'festival',
    'referer': 'https://www.sfoutsidelands.com/',
    'user-agent': 'Mozilla/5.0 (compatible; whatupsf/1.0)',
}

# One grouping id per festival day. Re-derive for a future year by loading
# /schedule/ in a browser and watching the schedule_groupings XHRs.
GROUPINGS = {1567: 'Friday', 1568: 'Saturday', 1569: 'Sunday'}

# API stage name -> venues.id. Matched on a normalised prefix rather than the
# full string: the Dolores' stage is renamed daily ("x Hot Goth GF" Friday,
# "x OASIS" Saturday, "x Polyglamorous" Sunday) and the API uses a curly
# apostrophe, so exact comparison against the venues table would miss.
STAGE_PREFIXES = [
    ('lands end', 28),
    ('sutro', 29),
    ('twin peaks', 30),
    ('panhandle', 31),
    ('dolores', 32),
    ('duboce', 33),
    ('soma', 34),
    ('cocktail magic', 35),
]


def venue_for_stage(stage):
    """Map an API stage label onto a venues.id, or None if unrecognised."""
    s = (stage or '').lower().replace('’', "'").strip()
    for prefix, venue_id in STAGE_PREFIXES:
        if s.startswith(prefix):
            return venue_id
    return None


def fetch_day(gid):
    req = urllib.request.Request(API.format(gid=gid), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def collect_shows():
    """Return {venue_id: [event dicts]} for the whole festival, plus a warning list."""
    by_venue = defaultdict(list)
    warnings = []

    for gid, label in GROUPINGS.items():
        data = fetch_day(gid)
        schedule = data['schedules'][0]
        shows = schedule['list']['shows']
        print(f"  {label:<9} (grouping {gid}): {len(shows)} shows — {schedule['name']}")

        for show in shows:
            venue_id = venue_for_stage(show.get('stage'))
            if venue_id is None:
                warnings.append(f"unmapped stage {show.get('stage')!r} for {show.get('name')!r}")
                continue
            name = (show.get('name') or '').strip()
            if not name:
                warnings.append(f"show {show.get('id')} on {show.get('stage')} has no name")
                continue
            # start is ISO-8601 already in festival-local time, e.g.
            # 2026-08-08T12:00:00.000-07:00 — split rather than parse-and-convert
            # so no timezone handling can shift an act into the wrong day.
            start = show['start']
            by_venue[venue_id].append({
                'band_name': name,
                'event_date': start[:10],
                'event_time': start[11:19],
                'event_price': 0,
            })

    return by_venue, warnings


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dry-run', action='store_true',
                    help='print the parsed schedule and exit without touching the DB')
    args = ap.parse_args()

    print('Fetching Outside Lands schedule...')
    by_venue, warnings = collect_shows()
    total = sum(len(v) for v in by_venue.values())
    print(f'\nParsed {total} shows across {len(by_venue)} stages.')

    for w in warnings:
        print(f'  [WARN] {w}')
    if not total:
        print('Nothing to ingest — aborting.')
        return 1

    if args.dry_run:
        for venue_id in sorted(by_venue):
            events = sorted(by_venue[venue_id], key=lambda e: (e['event_date'], e['event_time']))
            print(f"\n--- venue {venue_id} ({len(events)} shows) ---")
            for e in events:
                print(f"    {e['event_date']}  {e['event_time'][:5]}  {e['band_name']}")
        print('\nDry run — nothing written.')
        return 0

    # Resolve band ids (creates + AI-enriches any act we have not seen before,
    # which is what puts the video links in the map popups).
    print('\nResolving bands (new ones are enriched, this can take a while)...')
    band_cache, new_band_ids = {}, set()
    results = []
    for venue_id in sorted(by_venue):
        events = by_venue[venue_id]
        for e in events:
            e['band_id'] = lookup_or_create_band(e['band_name'], band_cache, new_band_ids)
        results.append({
            'venue_id': venue_id,
            'venue_name': f'OSL venue {venue_id}',
            'events': events,
        })
    print(f'  Bands: {len(new_band_ids)} new, {len(band_cache) - len(new_band_ids)} existing')

    # insert_events purges each venue before re-inserting, so this is a clean
    # reload — it also clears the bad rows the AI scraper left behind.
    print('\nWriting events...')
    inserted, purged, failed = insert_events(results)
    print(f'  inserted={inserted} purged={purged} failed={failed}')

    print('\nRegenerating publish.json...')
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    dump_latest_info('sfev')
    print('  done')
    return 0


if __name__ == '__main__':
    sys.exit(main())
