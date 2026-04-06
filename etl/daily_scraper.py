"""
WhatUpSF Daily Venue Scraper
Runs nightly at 3am to discover events at SF venues and update the database.

Phases:
  1. Venue fetch & calendar discovery  ✓
  2. AI calendar parsing               (current)
  3. Band lookup & AI enrichment
  4. Event insert & publish.json regeneration
  5. Scheduling & hardening
"""

import os
import sys
import json
import datetime
import requests
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from openai import OpenAI

# Load .env from repo root (one level up from etl/)
_env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

# Add etl directory to path so we can import venueETL
sys.path.insert(0, os.path.dirname(__file__))
from venueETL import get_db_connection

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OPENAI_MODEL = 'gpt-4o'  # swap to gpt-4.5 or gpt-5.4 when available
DB_NAME = os.environ.get('WHATUPSF_DB_NAME', 'sfev')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

CALENDAR_KEYWORDS = ['calendar', 'events', 'schedule', 'shows', 'gigs', 'live']

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    )
}

# Max characters of cleaned HTML to send to OpenAI (~12k tokens worth)
MAX_HTML_CHARS = 48_000

# ---------------------------------------------------------------------------
# OpenAI client (lazy init)
# ---------------------------------------------------------------------------
_client = None

def get_openai_client():
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY environment variable must be set")
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


def ask_openai(prompt, context=''):
    """Send a prompt to OpenAI and return the text response."""
    client = get_openai_client()
    messages = [{'role': 'user', 'content': prompt}]
    if context:
        messages = [{'role': 'system', 'content': context}] + messages
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=0,
    )
    return resp.choices[0].message.content.strip()


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
            if raw.startswith('http'):
                return raw
            elif raw.startswith('/'):
                parsed = urlparse(base_url)
                return f"{parsed.scheme}://{parsed.netloc}{raw}"
            else:
                return base_url.rstrip('/') + '/' + raw
    return None


def find_calendar_url_ai(homepage_html, base_url):
    """
    Ask OpenAI to find the calendar/events page URL from the homepage HTML.
    Returns an absolute URL string or None.
    """
    soup = BeautifulSoup(homepage_html, 'lxml')
    # Extract just the links to keep token cost low
    links = []
    for a in soup.find_all('a', href=True):
        text = a.get_text(strip=True)
        href = a['href']
        if text or href:
            links.append(f"{text} -> {href}")
    links_text = '\n'.join(links[:200])  # cap at 200 links

    prompt = (
        f"This is a list of links from a music venue homepage ({base_url}).\n\n"
        f"{links_text}\n\n"
        "Which link is most likely the calendar or events listing page? "
        "Reply with ONLY the URL (absolute or relative). "
        "If none look like a calendar page, reply with NONE."
    )
    try:
        answer = ask_openai(prompt)
        answer = answer.strip().strip('"').strip("'")
        if answer.upper() == 'NONE' or not answer:
            return None
        # Make absolute if needed
        if answer.startswith('http'):
            return answer
        elif answer.startswith('/'):
            parsed = urlparse(base_url)
            return f"{parsed.scheme}://{parsed.netloc}{answer}"
        else:
            return base_url.rstrip('/') + '/' + answer
    except Exception as e:
        print(f"    [AI ERROR] calendar URL lookup: {e}")
        return None


def discover_calendar_url(venue_id, venue_name, venue_url):
    """
    For a given venue, return (calendar_url, method) where method is
    'heuristic', 'ai_fallback', or None if discovery failed.
    """
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

    # AI fallback
    print(f"    [INFO] No heuristic match — trying AI fallback...")
    cal_url = find_calendar_url_ai(html, venue_url)
    if cal_url:
        return cal_url, 'ai_fallback'

    return None, None


# ---------------------------------------------------------------------------
# Phase 2: AI Calendar Parsing
# ---------------------------------------------------------------------------

def clean_html(raw_html):
    """Strip scripts, styles, and excess whitespace. Return plain text."""
    soup = BeautifulSoup(raw_html, 'lxml')
    for tag in soup(['script', 'style', 'noscript', 'meta', 'link', 'head']):
        tag.decompose()
    text = soup.get_text(separator='\n', strip=True)
    # Collapse blank lines
    lines = [l for l in text.splitlines() if l.strip()]
    return '\n'.join(lines)


def parse_events_with_ai(calendar_text, venue_name):
    """
    Send cleaned calendar text to OpenAI and return a list of event dicts.
    Each dict: {band_name, event_date (YYYY-MM-DD), event_time (HH:MM:SS), event_price (int)}
    Returns [] on failure.
    """
    today = datetime.date.today().isoformat()
    truncated = calendar_text[:MAX_HTML_CHARS]

    prompt = (
        f"You are parsing the events calendar for '{venue_name}', a music venue.\n"
        f"Today's date is {today}. Extract all upcoming events (on or after today).\n\n"
        f"Return ONLY a JSON array. Each element must have these exact keys:\n"
        f"  band_name   : string\n"
        f"  event_date  : string in YYYY-MM-DD format\n"
        f"  event_time  : string in HH:MM:SS format (use 20:00:00 if unknown)\n"
        f"  event_price : integer in dollars (0 if free or unknown)\n\n"
        f"If there are no upcoming events, return an empty array [].\n\n"
        f"Calendar content:\n{truncated}"
    )
    try:
        answer = ask_openai(prompt)
        # Strip markdown code fences if present
        answer = answer.strip()
        if answer.startswith('```'):
            answer = '\n'.join(answer.splitlines()[1:])
        if answer.endswith('```'):
            answer = '\n'.join(answer.splitlines()[:-1])
        events = json.loads(answer)
        if not isinstance(events, list):
            print(f"    [PARSE ERROR] Expected list, got {type(events)}")
            return []
        # Validate each event has required keys
        valid = []
        for e in events:
            if all(k in e for k in ('band_name', 'event_date', 'event_time', 'event_price')):
                valid.append(e)
            else:
                print(f"    [SKIP] Incomplete event: {e}")
        return valid
    except json.JSONDecodeError as e:
        print(f"    [JSON ERROR] {e}\n    Raw response: {answer[:200]}")
        return []
    except Exception as e:
        print(f"    [AI ERROR] parse_events: {e}")
        return []


def run_phase2():
    """
    Phase 2 entry point.
    Discovers calendar URLs (Phase 1) then parses events with AI.
    No DB writes.
    """
    print("=" * 60)
    print("PHASE 2: AI Calendar Parsing")
    print("=" * 60)

    venues = get_venues()
    print(f"Loaded {len(venues)} venues from DB\n")

    all_results = []
    for venue_id, venue_name, venue_url in venues:
        print(f"[{venue_id}] {venue_name}")

        # Step 1: find calendar URL
        cal_url, method = discover_calendar_url(venue_id, venue_name, venue_url)
        if not cal_url:
            print(f"    [SKIP] No calendar URL found\n")
            continue
        print(f"    Calendar URL ({method}): {cal_url}")

        # Step 2: fetch calendar page
        cal_html = fetch_html(cal_url)
        if not cal_html:
            print(f"    [SKIP] Could not fetch calendar page\n")
            continue

        # Step 3: clean and parse
        cal_text = clean_html(cal_html)
        print(f"    Cleaned text: {len(cal_text)} chars — sending to OpenAI...")
        events = parse_events_with_ai(cal_text, venue_name)

        print(f"    Found {len(events)} upcoming events:")
        for e in events:
            print(f"      {e['event_date']} {e['event_time']}  {e['band_name']}  ${e['event_price']}")

        all_results.append({
            'venue_id': venue_id,
            'venue_name': venue_name,
            'calendar_url': cal_url,
            'events': events,
        })
        print()

    # Summary
    total_events = sum(len(r['events']) for r in all_results)
    print(f"\nSummary: {len(all_results)} venues parsed, {total_events} total events found")
    return all_results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    run_phase2()
