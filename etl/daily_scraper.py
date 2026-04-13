"""
WhatUpSF Daily Venue Scraper
Runs nightly at 3am to discover events at SF venues and update the database.

Phases:
  1. Venue fetch & calendar discovery  ✓
  2. AI calendar parsing               ✓
  3. Band lookup & AI enrichment       ✓
  4. Event insert & publish.json regeneration  (current)
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
from venueETL import get_db_connection, dump_latest_info

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OPENAI_MODEL = 'gpt-5.4'
OPENAI_VISION_MODEL = 'gpt-5.4'
DB_NAME = os.environ.get('WHATUPSF_DB_NAME', 'sfev')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

DEBUG = False  # set via --debug flag

def dbg(*args):
    if DEBUG:
        print('[DEBUG]', *args)

CALENDAR_KEYWORDS = ['calendar', 'events', 'schedule', 'shows', 'gigs', 'live', 'music']
CALENDAR_BLOCKLIST = ['private', 'corporate', 'rental', 'hire', 'wedding']

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
        dbg(f"FETCH {url} -> {resp.status_code} ({len(resp.text)} chars)")
        return resp.text
    except Exception as e:
        print(f"    [FETCH ERROR] {url}: {e}")
        return None


# Minimum cleaned-text length before we consider a page JS-rendered
JS_RENDER_THRESHOLD = 1000


def fetch_html_rendered(url, wait_ms=3000):
    """
    Fetch a page using headless Chromium (Playwright) to get JS-rendered HTML.
    Tries 'networkidle' first, falls back to 'load' on timeout.
    Returns None on complete failure.
    """
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=HEADERS['User-Agent'])
                try:
                    page.goto(url, timeout=30000, wait_until='networkidle')
                except Exception:
                    # networkidle timed out — retry with 'load'
                    print(f"    [PLAYWRIGHT] networkidle timeout, retrying with wait_until=load...")
                    page.goto(url, timeout=30000, wait_until='load')
                page.wait_for_timeout(wait_ms)
                html = page.content()
                dbg(f"PLAYWRIGHT {url} -> {len(html)} chars")
                return html
            finally:
                browser.close()
    except Exception as e:
        print(f"    [PLAYWRIGHT ERROR] {url}: {e}")
        return None


def find_calendar_media_url(html, base_url):
    """
    Scan raw HTML for PDF or image URLs that might be a calendar.
    Returns the first matching absolute URL, or None.
    """
    import re
    if not html:
        return None

    def make_absolute(raw):
        if raw.startswith('//'):
            parsed = urlparse(base_url)
            return f"{parsed.scheme}:{raw}"
        if raw.startswith('http'):
            return raw
        if raw.startswith('/'):
            parsed = urlparse(base_url)
            return f"{parsed.scheme}://{parsed.netloc}{raw}"
        parsed = urlparse(base_url)
        return f"{parsed.scheme}://{parsed.netloc}/{raw}"

    # Patterns: PDF links (any), images only if path contains calendar keyword
    # Exclude small UI images like logos by requiring the URL to not come from a /images/calendarlogo/ path
    patterns = [
        r'href=["\']([^"\']*\.pdf)["\']',
        r'src=["\']([^"\']*\.pdf)["\']',
        r'content=["\']([^"\']+\.pdf)["\']',
        r'href=["\']([^"\']+/(?:calendar|events|schedule)[^"/\']*\.(?:jpg|jpeg|png|webp))["\']',
        r'src=["\']([^"\']+/(?:calendar|events|schedule)[^"/\']*\.(?:jpg|jpeg|png|webp))["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            url = make_absolute(m.group(1))
            dbg(f"FIND_MEDIA_URL pattern={pat!r} -> {url}")
            return url
    return None


def parse_events_from_image(media_url, venue_name):
    """
    Download a PDF or image, convert first page to PNG via PyMuPDF,
    then send to GPT-4o Vision with a calendar-parsing prompt.
    Returns list of event dicts (same shape as parse_events_with_ai).
    """
    import base64
    import tempfile

    today = datetime.date.today().isoformat()

    # Download the file
    try:
        resp = requests.get(media_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        raw_bytes = resp.content
        print(f"    [VISION] Downloaded {len(raw_bytes):,} bytes from {media_url}")
    except Exception as e:
        print(f"    [VISION ERROR] download failed: {e}")
        return []

    # Convert to PNG
    try:
        import fitz  # PyMuPDF
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tf:
            tf.write(raw_bytes)
            tmp_path = tf.name
        doc = fitz.open(tmp_path)
        page = doc[0]
        pix = page.get_pixmap(dpi=150)
        png_bytes = pix.tobytes('png')
        doc.close()
        os.unlink(tmp_path)
        print(f"    [VISION] Converted PDF page 1 to PNG ({len(png_bytes):,} bytes)")
    except Exception:
        # Not a PDF — treat raw bytes as image directly
        png_bytes = raw_bytes
        print(f"    [VISION] Using raw bytes as image ({len(png_bytes):,} bytes)")

    # Encode as base64
    b64 = base64.b64encode(png_bytes).decode()

    # Detect MIME type
    if png_bytes[:4] == b'\x89PNG':
        mime = 'image/png'
    elif png_bytes[:2] == b'\xff\xd8':
        mime = 'image/jpeg'
    else:
        mime = 'image/png'

    prompt = (
        f"This is a calendar page for '{venue_name}', a music venue.\n"
        f"Today's date is {today}. Extract all upcoming events (on or after today).\n\n"
        f"Return ONLY a JSON array. Each element must have these exact keys:\n"
        f"  band_name   : string\n"
        f"  event_date  : string in YYYY-MM-DD format\n"
        f"  event_time  : string in HH:MM:SS format (use 20:00:00 if unknown)\n"
        f"  event_price : integer in dollars (0 if free or unknown)\n\n"
        f"If there are no upcoming events, return an empty array [].\n"
        f"Return only the JSON, no markdown fences."
    )

    client = get_openai_client()
    try:
        resp = client.chat.completions.create(
            model=OPENAI_VISION_MODEL,
            messages=[{'role': 'user', 'content': [
                {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{b64}'}},
                {'type': 'text', 'text': prompt},
            ]}],
            temperature=0,
            max_completion_tokens=2048,
        )
        answer = resp.choices[0].message.content.strip()
        dbg(f"VISION RAW RESPONSE:\n{answer}\n")
        if answer.startswith('```'):
            answer = '\n'.join(answer.splitlines()[1:])
        if answer.endswith('```'):
            answer = '\n'.join(answer.splitlines()[:-1])
        events = json.loads(answer)
        if not isinstance(events, list):
            print(f"    [VISION PARSE ERROR] Expected list, got {type(events)}")
            return []
        valid = [e for e in events if all(k in e for k in ('band_name', 'event_date', 'event_time', 'event_price'))]
        print(f"    [VISION] Parsed {len(valid)} events from image")
        return valid
    except json.JSONDecodeError as e:
        print(f"    [VISION JSON ERROR] {e}\n    Raw: {answer[:200]}")
        return []
    except Exception as e:
        print(f"    [VISION ERROR] GPT-4o call failed: {e}")
        return []


def find_calendar_url_heuristic(homepage_html, base_url):
    """
    Search the homepage for a link that looks like a calendar/events page.
    Prefers links where the href itself contains a keyword (stronger signal)
    over links where only the anchor text matches.
    Returns the absolute URL string or None.
    """
    def make_absolute(raw):
        if raw.startswith('http'):
            return raw
        elif raw.startswith('/'):
            parsed = urlparse(base_url)
            return f"{parsed.scheme}://{parsed.netloc}{raw}"
        else:
            return base_url.rstrip('/') + '/' + raw

    base_netloc = urlparse(base_url).netloc

    def is_same_domain(url):
        netloc = urlparse(url).netloc
        return not netloc or netloc == base_netloc or netloc.endswith('.' + base_netloc)

    soup = BeautifulSoup(homepage_html, 'lxml')
    both_match = None   # best: keyword in href AND text (nav link to listing page)
    href_match = None   # ok: keyword in href only
    text_match = None   # fallback: keyword only in anchor text

    for a in soup.find_all('a', href=True):
        href = a['href'].lower()
        text = a.get_text(strip=True).lower()
        if any(bl in href for bl in CALENDAR_BLOCKLIST):
            continue
        abs_href = make_absolute(a['href'])
        if not is_same_domain(abs_href):
            continue  # skip external domains (e.g. google.com/calendar)
        kw_in_href = any(kw in href for kw in CALENDAR_KEYWORDS)
        kw_in_text = any(kw in text for kw in CALENDAR_KEYWORDS)
        if kw_in_href and kw_in_text and both_match is None:
            both_match = abs_href
        elif kw_in_href and not kw_in_text and href_match is None:
            href_match = abs_href
        elif kw_in_text and not kw_in_href and text_match is None:
            text_match = abs_href

    result = both_match or href_match or text_match
    dbg(f"HEURISTIC best_match={result}  (both={both_match} href={href_match} text={text_match})")
    return result


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
    dbg(f"AI CALENDAR URL PROMPT:\n{prompt}\n")
    try:
        answer = ask_openai(prompt)
        dbg(f"AI CALENDAR URL RESPONSE: {answer}")
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
    'heuristic', 'ai_fallback', 'homepage', or None if discovery failed.
    If the homepage is JS-rendered, Playwright-renders it before discovery.
    Falls back to the homepage URL itself if no separate calendar page is found.
    """
    if not venue_url.startswith('http'):
        venue_url = 'https://' + venue_url

    print(f"  Fetching homepage: {venue_url}")
    html = fetch_html(venue_url)
    if not html:
        return None, None

    # If homepage itself is JS-rendered, render it before discovery
    if len(html) < JS_RENDER_THRESHOLD * 2:
        print(f"    Homepage looks JS-rendered ({len(html)} chars), using Playwright for discovery...")
        rendered = fetch_html_rendered(venue_url)
        if rendered:
            html = rendered

    # Try heuristic first (no AI cost)
    cal_url = find_calendar_url_heuristic(html, venue_url)
    if cal_url:
        return cal_url, 'heuristic'

    # AI fallback
    print(f"    [INFO] No heuristic match — trying AI fallback...")
    cal_url = find_calendar_url_ai(html, venue_url)
    if cal_url:
        return cal_url, 'ai_fallback'

    # Last resort: treat the homepage itself as the calendar page
    print(f"    [INFO] No calendar link found — treating homepage as calendar")
    return venue_url, 'homepage'


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
    dbg(f"CALENDAR TEXT ({len(calendar_text)} chars, truncated to {len(truncated)}):\n{truncated[:2000]}\n...")

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
    dbg(f"PARSE EVENTS PROMPT:\n{prompt}\n")
    try:
        answer = ask_openai(prompt)
        dbg(f"PARSE EVENTS RAW RESPONSE:\n{answer}\n")
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
        events = []
        if len(cal_text) < JS_RENDER_THRESHOLD:
            print(f"    Cleaned text: {len(cal_text)} chars — JS-rendered, trying Playwright...")
            rendered = fetch_html_rendered(cal_url)
            rendered_text = clean_html(rendered) if rendered else ''
            if rendered and len(rendered_text) >= JS_RENDER_THRESHOLD:
                cal_text = rendered_text
                print(f"    Rendered text: {len(cal_text)} chars — sending to OpenAI...")
                events = parse_events_with_ai(cal_text, venue_name)
            else:
                # Playwright failed or rendered page is still content-empty — check for PDF/image
                if rendered:
                    print(f"    Rendered text: {len(rendered_text)} chars — still too short, scanning for PDF/image...")
                    scan_html = rendered  # prefer rendered HTML for better link coverage
                else:
                    print(f"    [FALLBACK] Playwright failed — scanning for PDF/image calendar...")
                    scan_html = cal_html
                media_url = find_calendar_media_url(scan_html, cal_url)
                if media_url:
                    print(f"    [FALLBACK] Found media URL: {media_url} — using GPT-4o Vision...")
                    events = parse_events_from_image(media_url, venue_name)
                else:
                    print(f"    [SKIP] No PDF/image found, skipping venue")
                    continue
        else:
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
# Phase 3: Band Lookup & AI Enrichment
# ---------------------------------------------------------------------------

def search_instagram(band_name):
    """Search Instagram topsearch API. Returns profile URL or empty string."""
    from urllib.parse import quote_plus
    query = quote_plus(band_name)
    url = f"https://www.instagram.com/web/search/topsearch/?query={query}&context=blended"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code == 200:
            users = resp.json().get('users', [])
            if users:
                username = users[0]['user']['username']
                return f"https://www.instagram.com/{username}/"
    except Exception as e:
        print(f"    [IG ERROR] search for '{band_name}': {e}")
    return ''


def search_youtube(band_name):
    """Search YouTube, return the first non-ad videoId URL or empty string."""
    import re
    from urllib.parse import quote_plus
    query = quote_plus(band_name)
    url = f"https://www.youtube.com/results?search_query={query}"
    try:
        html = fetch_html(url)
        if not html:
            return ''
        # First videoId in search results HTML is the top organic result
        video_ids = list(dict.fromkeys(re.findall(r'"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"', html)))
        if video_ids:
            return f"https://www.youtube.com/watch?v={video_ids[0]}"
    except Exception as e:
        print(f"    [YT ERROR] search for '{band_name}': {e}")
    return ''


def search_soundcloud(band_name):
    """Search SoundCloud, return the first track or artist URL or empty string."""
    import re
    from urllib.parse import quote_plus
    query = quote_plus(band_name)
    url = f"https://soundcloud.com/search?q={query}"
    try:
        html = fetch_html(url)
        if not html:
            return ''
        # SoundCloud embeds canonical URLs in og:url or link tags before JS renders
        match = re.search(r'<link rel="canonical" href="(https://soundcloud\.com/[^"]+)"', html)
        if match:
            return match.group(1)
        # Fallback: grab first soundcloud.com/{user}/{track} href in page
        links = re.findall(r'href="(https://soundcloud\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+)"', html)
        if links:
            return links[0]
    except Exception as e:
        print(f"    [SC ERROR] search for '{band_name}': {e}")
    return ''


def search_media_url(band_name):
    """Try Instagram, then YouTube, then SoundCloud. Return first result found."""
    if 'karaoke' in band_name.lower():
        return ''
    url = search_instagram(band_name)
    if url:
        print(f"    [MEDIA] Instagram: {url}")
        return url
    url = search_youtube(band_name)
    if url:
        print(f"    [MEDIA] YouTube: {url}")
        return url
    url = search_soundcloud(band_name)
    if url:
        print(f"    [MEDIA] SoundCloud: {url}")
        return url
    print(f"    [MEDIA] No result found")
    return ''


def enrich_band_with_ai(band_name):
    """
    Ask OpenAI for a band description + image URL, and search YouTube for media_url.
    Returns dict with description, media_url, image_url.
    """
    prompt = (
        f"You are a music research assistant. For the band or artist named '{band_name}':\n"
        f"1. Write a 1-2 sentence description of the act and their genre.\n"
        f"2. Provide an image URL (band photo or album cover) from a reputable source (or empty string if unknown).\n\n"
        f"Return ONLY a JSON object with exactly these keys:\n"
        f"  description : string\n"
        f"  image_url   : string (image URL or empty string)\n\n"
        f"Return only the JSON, no markdown fences."
    )
    try:
        answer = ask_openai(prompt)
        answer = answer.strip()
        if answer.startswith('```'):
            answer = '\n'.join(answer.splitlines()[1:])
        if answer.endswith('```'):
            answer = '\n'.join(answer.splitlines()[:-1])
        data = json.loads(answer)
    except Exception as e:
        print(f"    [AI ERROR] band enrichment for '{band_name}': {e}")
        data = {}

    media_url = search_media_url(band_name)
    return {
        'description': data.get('description', ''),
        'media_url': media_url,
        'image_url': data.get('image_url', ''),
    }


def lookup_or_create_band(band_name, band_cache, new_band_ids):
    """
    Look up a band by name (case-insensitive). If not found, enrich with AI and insert.
    band_cache  : dict {name_lower: band_id} shared across the run to avoid redundant DB hits.
    new_band_ids: set of band_ids inserted this run (for summary reporting).
    Returns band_id (int) or None on failure.
    """
    key = band_name.strip().lower()
    if key in band_cache:
        return band_cache[key]

    db = get_db_connection(DB_NAME)
    cursor = db.cursor()
    try:
        cursor.execute("SELECT id FROM bands WHERE LOWER(name) = %s", (key,))
        row = cursor.fetchone()
        if row:
            band_id = row[0]
            band_cache[key] = band_id
            return band_id

        # New band — enrich with AI then insert
        print(f"    [NEW BAND] '{band_name}' — enriching with AI...")
        enrichment = enrich_band_with_ai(band_name)
        cursor.execute(
            "INSERT INTO bands (name, media_url, image_url, descriptions) VALUES (%s, %s, %s, %s)",
            (band_name, enrichment['media_url'], enrichment['image_url'], enrichment['description']),
        )
        db.commit()
        band_id = cursor.lastrowid
        band_cache[key] = band_id
        new_band_ids.add(band_id)
        print(f"    [INSERTED] bands.id={band_id}  media={enrichment['media_url'] or '(none)'}")
        return band_id
    except Exception as e:
        print(f"    [DB ERROR] lookup_or_create_band '{band_name}': {e}")
        return None
    finally:
        db.close()


CACHE_FILE = os.path.join(os.path.dirname(__file__), '.scraper_cache.json')


def save_cache(results):
    with open(CACHE_FILE, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"  [CACHE] Saved to {CACHE_FILE}")


def load_cache():
    if not os.path.exists(CACHE_FILE):
        raise FileNotFoundError(f"No cache file found at {CACHE_FILE}. Run without --phase 4 first.")
    with open(CACHE_FILE) as f:
        return json.load(f)


def run_phase3(phase2_results):
    """
    Phase 3 entry point.
    Takes Phase 2 results and resolves/inserts each band.
    Attaches band_id to every event dict in-place.
    Saves results to cache file so Phase 4 can run independently.
    Returns the same list (mutated) with band_id populated.
    """
    print("=" * 60)
    print("PHASE 3: Band Lookup & AI Enrichment")
    print("=" * 60)

    band_cache = {}   # {name_lower: band_id} — shared across all venues this run
    new_band_ids = set()  # band_ids inserted this run
    total_events = 0
    total_failed = 0

    for venue_result in phase2_results:
        events = venue_result['events']
        if not events:
            continue

        print(f"\n[{venue_result['venue_id']}] {venue_result['venue_name']} — {len(events)} events")
        for event in events:
            band_name = event.get('band_name', '').strip()
            if not band_name:
                event['band_id'] = None
                total_failed += 1
                continue

            band_id = lookup_or_create_band(band_name, band_cache, new_band_ids)
            event['band_id'] = band_id
            total_events += 1
            if band_id is None:
                total_failed += 1

    existing_count = len(band_cache) - len(new_band_ids)
    print(f"\nPhase 3 Summary:")
    print(f"  Events processed  : {total_events}")
    print(f"  Unique bands       : {len(band_cache)}")
    print(f"    New (inserted)   : {len(new_band_ids)}")
    print(f"    Existing (reused): {existing_count}")
    print(f"  Failed (no name)   : {total_failed}")

    save_cache(phase2_results)
    return phase2_results


# ---------------------------------------------------------------------------
# Phase 4: Event Insert & publish.json Regeneration
# ---------------------------------------------------------------------------

def insert_events(phase3_results):
    """
    Insert events into the events table, skipping duplicates.
    Dedup key: (venue_id, band_id, event_date).
    Returns (inserted_count, skipped_count).
    """
    db = get_db_connection(DB_NAME)
    cursor = db.cursor()
    inserted = 0
    skipped = 0
    failed = 0

    try:
        for venue_result in phase3_results:
            venue_id = venue_result['venue_id']
            venue_name = venue_result['venue_name']
            events = venue_result.get('events', [])
            if not events:
                continue

            for event in events:
                band_id = event.get('band_id')
                if band_id is None:
                    failed += 1
                    continue

                event_date = event.get('event_date', '')
                event_time = event.get('event_time', '20:00:00')
                event_price = event.get('event_price', 0)

                # Dedup check
                cursor.execute(
                    "SELECT id FROM events WHERE venue_id=%s AND band_id=%s AND event_date=%s",
                    (venue_id, band_id, event_date),
                )
                if cursor.fetchone():
                    skipped += 1
                    continue

                cursor.execute(
                    "INSERT INTO events (venue_id, band_id, event_date, event_time, event_price) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (venue_id, band_id, event_date, event_time, int(event_price or 0)),
                )
                inserted += 1

        db.commit()
    except Exception as e:
        print(f"  [DB ERROR] insert_events: {e}")
        db.rollback()
    finally:
        db.close()

    return inserted, skipped, failed


def run_phase4(phase3_results):
    """
    Phase 4 entry point.
    Inserts events into DB then regenerates publish.json.
    """
    print("=" * 60)
    print("PHASE 4: Event Insert & publish.json Regeneration")
    print("=" * 60)

    inserted, skipped, failed = insert_events(phase3_results)
    print(f"\nEvent inserts:")
    print(f"  Inserted : {inserted}")
    print(f"  Skipped  : {skipped}  (already in DB)")
    print(f"  Failed   : {failed}  (missing band_id)")

    # Regenerate publish.json
    publish_path = os.path.join(os.path.dirname(__file__), 'publish.json')
    orig_dir = os.getcwd()
    os.chdir(os.path.dirname(__file__))
    try:
        print(f"\nRegenerating publish.json...")
        dump_latest_info(DB_NAME)
        print(f"  Written: {publish_path}")
    finally:
        os.chdir(orig_dir)


# ---------------------------------------------------------------------------
# Backfill: missing media_url
# ---------------------------------------------------------------------------

def backfill_media_urls(redo_all=False):
    """
    Fill in media_url for bands via YouTube search.
    redo_all=False: only bands with empty/NULL media_url.
    redo_all=True:  all bands, overwriting existing values.
    """
    db = get_db_connection(DB_NAME)
    cursor = db.cursor()
    try:
        if redo_all:
            cursor.execute("SELECT id, name FROM bands")
        else:
            cursor.execute("SELECT id, name FROM bands WHERE media_url IS NULL OR media_url = ''")
        bands = cursor.fetchall()
    finally:
        db.close()

    print(f"Backfilling media_url for {len(bands)} bands...")
    updated = 0
    for band_id, band_name in bands:
        media_url = search_media_url(band_name)
        if not media_url:
            if 'karaoke' in band_name.lower():
                # Explicitly clear any existing media_url
                db = get_db_connection(DB_NAME)
                cursor = db.cursor()
                try:
                    cursor.execute("UPDATE bands SET media_url=NULL WHERE id=%s", (band_id,))
                    db.commit()
                    print(f"  [CLEARED] {band_name}")
                finally:
                    db.close()
            else:
                print(f"  [SKIP] No result for '{band_name}'")
            continue
        db = get_db_connection(DB_NAME)
        cursor = db.cursor()
        try:
            cursor.execute("UPDATE bands SET media_url=%s WHERE id=%s", (media_url, band_id))
            db.commit()
            updated += 1
            print(f"  [{band_id}] {band_name} -> {media_url}")
        except Exception as e:
            print(f"  [DB ERROR] '{band_name}': {e}")
        finally:
            db.close()

    print(f"\nDone. Updated {updated}/{len(bands)} bands.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='WhatUpSF daily scraper')
    parser.add_argument('--phase', type=int, choices=[1, 2, 3, 4], default=None,
                        help='Run only up to this phase (default: run all)')
    parser.add_argument('--venue', type=int, default=None,
                        help='Run against a single venue by ID (Phase 1+2 diagnostic by default)')
    parser.add_argument('--full', action='store_true',
                        help='With --venue: run all 4 phases with DB writes for that venue')
    parser.add_argument('--debug', action='store_true',
                        help='Enable verbose debug logging')
    parser.add_argument('--backfill-media', action='store_true',
                        help='Fill in missing media_url for bands in DB via YouTube search')
    parser.add_argument('--backfill-media-all', action='store_true',
                        help='Redo media_url for ALL bands via YouTube search (overwrites existing)')
    parser.add_argument('--dump-only', action='store_true',
                        help='Just regenerate publish.json from current DB state (no scraping)')
    args = parser.parse_args()

    if args.debug:
        globals()['DEBUG'] = True

    phase = args.phase  # None means run all phases

    if args.venue:
        venue_id = args.venue
        venues = get_venues()
        match = [(vid, vname, vurl) for vid, vname, vurl in venues if vid == venue_id]
        if not match:
            print(f"No venue found with id={venue_id}")
            sys.exit(1)
        vid, vname, vurl = match[0]
        print(f"[{vid}] {vname}  ({vurl})\n")
        cal_url, method = discover_calendar_url(vid, vname, vurl)
        if not cal_url:
            print("  [FAIL] Could not discover calendar URL")
            sys.exit(1)
        print(f"  Calendar URL ({method}): {cal_url}\n")
        cal_html = fetch_html(cal_url)
        if not cal_html:
            print("  [FAIL] Could not fetch calendar page")
            sys.exit(1)
        cal_text = clean_html(cal_html)
        events = []
        if len(cal_text) < JS_RENDER_THRESHOLD:
            print(f"  Cleaned text: {len(cal_text)} chars — JS-rendered, trying Playwright...")
            rendered = fetch_html_rendered(cal_url)
            rendered_text = clean_html(rendered) if rendered else ''
            if rendered and len(rendered_text) >= JS_RENDER_THRESHOLD:
                cal_text = rendered_text
                print(f"  Rendered text: {len(cal_text)} chars — sending to OpenAI...\n")
                events = parse_events_with_ai(cal_text, vname)
            else:
                if rendered:
                    print(f"  Rendered text: {len(rendered_text)} chars — still too short, scanning for PDF/image...")
                    scan_html = rendered
                else:
                    print(f"  [FALLBACK] Playwright failed — scanning for PDF/image calendar...")
                    scan_html = cal_html
                media_url = find_calendar_media_url(scan_html, cal_url)
                if media_url:
                    print(f"  [FALLBACK] Found media URL: {media_url} — using GPT-4o Vision...")
                    events = parse_events_from_image(media_url, vname)
                else:
                    print("  [FAIL] No PDF/image found")
                    sys.exit(1)
        else:
            print(f"  Cleaned text: {len(cal_text)} chars — sending to OpenAI...\n")
            events = parse_events_with_ai(cal_text, vname)
        print(f"\n  Found {len(events)} upcoming events:")
        for e in events:
            print(f"    {e['event_date']} {e['event_time']}  {e['band_name']}  ${e['event_price']}")

        if args.full:
            if not events:
                print("\n  No events to insert.")
            else:
                venue_result = [{'venue_id': vid, 'venue_name': vname, 'calendar_url': cal_url, 'events': events}]
                band_cache, new_band_ids = {}, set()
                for event in events:
                    band_name = event.get('band_name', '').strip()
                    if band_name:
                        event['band_id'] = lookup_or_create_band(band_name, band_cache, new_band_ids)
                print(f"\n  Bands: {len(new_band_ids)} new, {len(band_cache) - len(new_band_ids)} existing")
                run_phase4(venue_result)
        else:
            print("\n  (dry run — use --full to write to DB)")
    elif args.dump_only:
        publish_path = os.path.join(os.path.dirname(__file__), 'publish.json')
        orig_dir = os.getcwd()
        os.chdir(os.path.dirname(__file__))
        try:
            dump_latest_info(DB_NAME)
            print(f"publish.json regenerated: {publish_path}")
        finally:
            os.chdir(orig_dir)
    elif args.backfill_media_all:
        backfill_media_urls(redo_all=True)
    elif args.backfill_media:
        backfill_media_urls()
    elif phase == 1:
        venues = get_venues()
        print(f"Loaded {len(venues)} venues\n")
        for venue_id, venue_name, venue_url in venues:
            print(f"[{venue_id}] {venue_name}")
            cal_url, method = discover_calendar_url(venue_id, venue_name, venue_url)
            print(f"    -> {cal_url}  ({method})\n")
    elif phase == 2:
        run_phase2()
    elif phase == 3:
        phase2_results = run_phase2()
        run_phase3(phase2_results)
    elif phase == 4:
        # Load from cache — no need to re-scrape
        results = load_cache()
        run_phase4(results)
    else:
        # No --phase specified: run full pipeline
        phase2_results = run_phase2()
        phase3_results = run_phase3(phase2_results)
        run_phase4(phase3_results)
