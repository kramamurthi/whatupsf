"""
WhatUpSF Daily Venue Scraper
Runs nightly at 3am to discover events at SF venues and update the database.

Phases:
  1. Venue fetch & calendar discovery  (current)
  2. AI calendar parsing
  3. Band lookup & AI enrichment
  4. Event insert & publish.json regeneration
  5. Scheduling & hardening
"""

import os
import sys
import requests
from bs4 import BeautifulSoup

# Add etl directory to path so we can import venueETL
sys.path.insert(0, os.path.dirname(__file__))
from venueETL import get_db_connection

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OPENAI_MODEL = 'gpt-4o'  # swap to gpt-4.5 or gpt-5.4 when available
DB_NAME = os.environ.get('WHATUPSF_DB_NAME', 'sfev')

CALENDAR_KEYWORDS = ['calendar', 'events', 'schedule', 'shows', 'gigs', 'live']

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    )
}

# ---------------------------------------------------------------------------
# Phase 1: Venue Fetch & Calendar Discovery
# ---------------------------------------------------------------------------

def get_venues():
    """Read all venues from MySQL. Returns list of (id, name, url) tuples."""
    db = get_db_connection(DB_NAME)
    cursor = db.cursor()
    try:
        cursor.execute("SELECT id, name, url FROM venues WHERE url != ''")
        return cursor.fetchall()
    finally:
        db.close()


def fetch_html(url, timeout=15):
    """Fetch a URL and return the response text. Returns None on failure."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"    [FETCH ERROR] {url}: {e}")
        return None


def find_calendar_url_heuristic(homepage_html, base_url):
    """
    Search the homepage for a link that looks like a calendar/events page.
    Returns the absolute URL string or None.
    """
    soup = BeautifulSoup(homepage_html, 'lxml')
    for a in soup.find_all('a', href=True):
        href = a['href'].lower()
        text = a.get_text(strip=True).lower()
        if any(kw in href or kw in text for kw in CALENDAR_KEYWORDS):
            raw = a['href']
            # Make absolute
            if raw.startswith('http'):
                return raw
            elif raw.startswith('/'):
                # Derive scheme+host from base_url
                from urllib.parse import urlparse
                parsed = urlparse(base_url)
                return f"{parsed.scheme}://{parsed.netloc}{raw}"
            else:
                return base_url.rstrip('/') + '/' + raw
    return None


def discover_calendar_url(venue_id, venue_name, venue_url):
    """
    For a given venue, return (calendar_url, method) where method is
    'heuristic' or 'ai_fallback' or None if discovery failed.
    """
    # Ensure URL has a scheme
    if not venue_url.startswith('http'):
        venue_url = 'https://' + venue_url

    print(f"  Fetching homepage: {venue_url}")
    html = fetch_html(venue_url)
    if not html:
        return None, None

    # Try heuristic first (no AI cost)
    cal_url = find_calendar_url_heuristic(html, venue_url)
    if cal_url:
        return cal_url, 'heuristic'

    # AI fallback — Phase 1 stubs this; will be wired up in Phase 2
    print(f"    [INFO] No heuristic match — AI fallback not yet implemented (Phase 2)")
    return None, None


def run_phase1():
    """
    Phase 1 entry point.
    Discovers calendar URLs for all venues. Prints results. No DB writes.
    """
    print("=" * 60)
    print("PHASE 1: Venue Fetch & Calendar Discovery")
    print("=" * 60)

    venues = get_venues()
    print(f"Loaded {len(venues)} venues from DB\n")

    results = []
    for venue_id, venue_name, venue_url in venues:
        print(f"[{venue_id}] {venue_name}")
        cal_url, method = discover_calendar_url(venue_id, venue_name, venue_url)
        if cal_url:
            print(f"    FOUND ({method}): {cal_url}")
        else:
            print(f"    NOT FOUND")
        results.append({
            'venue_id': venue_id,
            'venue_name': venue_name,
            'venue_url': venue_url,
            'calendar_url': cal_url,
            'method': method,
        })
        print()

    # Summary
    found = [r for r in results if r['calendar_url']]
    print(f"\nSummary: {len(found)}/{len(venues)} calendar URLs discovered")
    for r in results:
        status = r['calendar_url'] or 'NOT FOUND'
        print(f"  {r['venue_name']}: {status}")

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    run_phase1()
