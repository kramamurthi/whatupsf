"""
WhatUpSF Daily Venue Scraper
Runs nightly at 3am to discover events at SF venues and update the database.

Phases:
  1. Venue fetch & calendar discovery  ✓
  2. AI calendar parsing               ✓
  3. Band lookup & AI enrichment       ✓
  4. Event insert & publish.json regeneration  ✓
  5. Scheduling & hardening            ✓
"""

import os
import sys
import json
import time
import smtplib
import traceback
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

# Alerting — set these in .env to receive a summary email after each run
ALERT_EMAIL = os.environ.get('ALERT_EMAIL', '')
SMTP_HOST   = os.environ.get('SMTP_HOST', 'localhost')
SMTP_PORT   = int(os.environ.get('SMTP_PORT', '25'))
SMTP_USER   = os.environ.get('SMTP_USER', '')
SMTP_PASS   = os.environ.get('SMTP_PASS', '')
SMTP_FROM   = os.environ.get('SMTP_FROM', ALERT_EMAIL)

# Log directory (created at runtime)
LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')

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
# Logging — tee stdout/stderr to a daily log file
# ---------------------------------------------------------------------------

class _Tee:
    """Mirror writes to both a live stream and a log file, prepending timestamps."""
    def __init__(self, stream, logfile):
        self._stream  = stream
        self._logfile = logfile
        self._at_bol  = True   # track beginning-of-line for timestamp placement

    def write(self, data):
        self._stream.write(data)
        if data:
            if self._at_bol:
                ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S  ')
                self._logfile.write(ts)
            self._logfile.write(data)
            self._at_bol = data.endswith('\n')
            self._logfile.flush()

    def flush(self):
        self._stream.flush()
        self._logfile.flush()

    def isatty(self):
        return False


_log_file_handle = None  # module-level ref prevents GC


def setup_logging():
    """
    Redirect stdout/stderr to a Tee that writes timestamped lines to
    logs/scraper_YYYY-MM-DD.log while still printing to the terminal.
    Returns the path to the log file.
    """
    global _log_file_handle
    os.makedirs(LOG_DIR, exist_ok=True)
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    log_path = os.path.join(LOG_DIR, f'scraper_{today}.log')
    _log_file_handle = open(log_path, 'a', buffering=1)
    sys.stdout = _Tee(sys.__stdout__, _log_file_handle)
    sys.stderr = _Tee(sys.__stderr__, _log_file_handle)
    return log_path


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
    """Send a prompt to OpenAI and return the text response (with retry)."""
    client = get_openai_client()
    messages = [{'role': 'user', 'content': prompt}]
    if context:
        messages = [{'role': 'system', 'content': context}] + messages

    def _do():
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0,
        )
        return resp.choices[0].message.content.strip()

    return _retry(_do, attempts=3, delay=10, label='OpenAI')


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

def _retry(fn, attempts=3, delay=5, label=''):
    """
    Call fn() up to `attempts` times, sleeping `delay` seconds between tries.
    Returns the result on success; raises the last exception after exhausting retries.
    """
    last_exc = None
    for i in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if i < attempts:
                print(f"    [RETRY {i}/{attempts - 1}] {label or getattr(fn, '__name__', 'fn')}: {exc} — retrying in {delay}s...")
                time.sleep(delay)
    raise last_exc


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
    """Fetch a URL and return the response text. Returns None on failure (3 tries)."""
    def _do():
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
        dbg(f"FETCH {url} -> {resp.status_code} ({len(resp.text)} chars)")
        return resp.text
    try:
        return _retry(_do, attempts=3, delay=5, label=f'GET {url}')
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
        f"  band_name   : string  — exactly ONE artist or band name\n"
        f"  event_date  : string in YYYY-MM-DD format\n"
        f"  event_time  : string in HH:MM:SS format (use 20:00:00 if unknown)\n"
        f"  event_price : integer in dollars (0 if free or unknown)\n\n"
        f"IMPORTANT rules:\n"
        f"1. MULTI-BAND EVENTS: If multiple acts share one date (separated by '/', '&', 'and', 'with', '+'),\n"
        f"   create ONE separate JSON entry per act. The first act listed is the headliner (plays last),\n"
        f"   the last act listed is the opener (plays first). Assign the listed event time to the opener\n"
        f"   (last in the list) and add 1 hour per slot toward the headliner (first in the list).\n"
        f"2. For non-music events (karaoke nights, trivia, open mic, bingo, pub quiz, comedy shows,\n"
        f"   book readings, game nights, private/corporate events), still include them but use the\n"
        f"   event type as the band_name (e.g. 'Karaoke Night', 'Trivia Night').\n"
        f"3. Each band_name must contain exactly ONE act or event name — no descriptions like '(headliner)'.\n\n"
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
        valid = expand_multi_band_events(valid)
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


# ---------------------------------------------------------------------------
# Band-name filtering & multi-band expansion
# ---------------------------------------------------------------------------

import re as _re

_NON_MUSIC_RE = _re.compile(
    r'\b('
    r'karaoke|trivia|open\s+mic|open\s+mike|'
    r'book\s+(club|reading|signing|talk)|'
    r'comedy\s+(night|show|open\s+mic)|stand\s*-?\s*up|standup|'
    r'palooza\b|'                            # *palooza without a named headliner
    r'private\s+(event|party)|corporate|'
    r'bingo|pub\s+quiz|quiz\s+night|'
    r'speed\s+dating|wine\s+tasting|'
    r'game\s+night|movie\s+night|film\s+screening|'
    r'art\s+(show|opening|exhibit)|gallery\s+opening|'
    r'drag\s+bingo|'
    r'open\s+bar|happy\s+hour\s+event|'
    r'tba|tbd|to\s+be\s+(announced|determined|confirmed)'
    r')\b',
    _re.IGNORECASE,
)

# Separators that reliably indicate multiple bands on one bill.
# We intentionally exclude bare "and"/"with" to avoid splitting band names
# like "Simon & Garfunkel" or "Me and My Monkey". Slash is the clearest.
_MULTI_BAND_RE = _re.compile(r'\s*/\s*')


def is_non_music_act(name: str) -> bool:
    """Return True if name looks like a non-music event rather than a band/artist."""
    return bool(_NON_MUSIC_RE.search(name))


def _parse_time_minutes(time_str: str) -> int:
    """Parse HH:MM:SS into total minutes since midnight. Returns 20*60 on failure."""
    try:
        parts = time_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return 20 * 60


def _minutes_to_time(minutes: int, seconds: int = 0) -> str:
    """Convert total minutes since midnight back to HH:MM:SS."""
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}:{seconds:02d}"


def expand_multi_band_events(events: list) -> list:
    """
    Defensive post-processing after AI parsing:
    - Split band_name fields that still contain ' / ' into one entry per act.
    - Drop any entry whose band_name matches non-music patterns.
    - For multi-band splits, stagger set times: listed time → last act (opener),
      +1hr per step toward first act (headliner). E.g. "A / B / C" at 20:00
      → C=20:00, B=21:00, A=22:00.
    The AI prompt already requests splitting; this is a safety net.
    """
    expanded = []
    for event in events:
        raw = event.get('band_name', '').strip()
        parts = [p.strip() for p in _MULTI_BAND_RE.split(raw) if p.strip()]
        if not parts:
            continue

        music_parts = [p for p in parts if p]
        if not music_parts:
            continue

        n = len(music_parts)
        base_time_str = event.get('event_time', '20:00:00')
        base_minutes = _parse_time_minutes(base_time_str)
        try:
            seconds = int(base_time_str.split(':')[2])
        except Exception:
            seconds = 0

        for i, part in enumerate(music_parts):
            entry = dict(event)
            entry['band_name'] = part
            if n > 1:
                # headliner (i=0) plays last → highest offset; opener (i=n-1) plays at base time
                offset = (n - 1 - i) * 60
                entry['event_time'] = _minutes_to_time(base_minutes + offset, seconds)
            expanded.append(entry)

    return expanded


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
        f"  band_name   : string  — exactly ONE artist or band name\n"
        f"  event_date  : string in YYYY-MM-DD format\n"
        f"  event_time  : string in HH:MM:SS format (use 20:00:00 if unknown)\n"
        f"  event_price : integer in dollars (0 if free or unknown)\n\n"
        f"IMPORTANT rules:\n"
        f"1. MULTI-BAND EVENTS: If multiple acts share one date (separated by '/', '&', 'and', 'with', '+'),\n"
        f"   create ONE separate JSON entry per act. The first act listed is the headliner (plays last),\n"
        f"   the last act listed is the opener (plays first). Assign the listed event time to the opener\n"
        f"   (last in the list) and add 1 hour per slot toward the headliner (first in the list).\n"
        f"   Example: 'Grimmer / Stouper / Hearing Loss' at 20:00 →\n"
        f"     Hearing Loss 20:00, Stouper 21:00, Grimmer 22:00.\n"
        f"2. For non-music events (karaoke nights, trivia, open mic, bingo, pub quiz, comedy shows,\n"
        f"   book readings, game nights, wine tastings, private/corporate events), still include them\n"
        f"   but use the event type as the band_name (e.g. 'Karaoke Night', 'Trivia Night').\n"
        f"   Skip only events with no useful name at all.\n"
        f"3. Each band_name must contain exactly ONE act or event name — no descriptions like '(headliner)'.\n\n"
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
        return expand_multi_band_events(valid)
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
    venue_errors = []   # [(venue_id, venue_name, error_message)]

    for venue_id, venue_name, venue_url in venues:
        print(f"[{venue_id}] {venue_name}")
        try:
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

        except Exception as exc:
            msg = str(exc)
            venue_errors.append((venue_id, venue_name, msg))
            print(f"    [ERROR] Unhandled exception — skipping venue: {msg}")
            traceback.print_exc()
            print()

    # Summary
    total_events = sum(len(r['events']) for r in all_results)
    print(f"\nSummary: {len(all_results)} venues parsed, {total_events} total events found")
    if venue_errors:
        print(f"Venues with errors ({len(venue_errors)}):")
        for vid, vname, err in venue_errors:
            print(f"  [{vid}] {vname}: {err}")
    return all_results, venue_errors


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
    query = quote_plus(f"{band_name} band music")
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
    query = quote_plus(f"{band_name} band music")
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
    """Try YouTube, then SoundCloud. Return first result found."""
    if is_non_music_act(band_name):
        return ''
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
    Skips enrichment for non-music acts (karaoke nights, trivia, etc.) — they get
    inserted into the DB but with empty enrichment fields.
    Returns dict with description, media_url, image_url.
    """
    if is_non_music_act(band_name):
        print(f"    [SKIP ENRICHMENT] Non-music act: '{band_name}'")
        return {'description': '', 'media_url': '', 'image_url': ''}

    prompt = (
        f"You are a music research assistant. '{band_name}' is a MUSIC ACT (band or solo artist)\n"
        f"currently performing at live music venues in San Francisco, CA.\n"
        f"Search specifically for a musical act with this name — not a place, concept, or anything else.\n\n"
        f"1. Write a 1-2 sentence description of the act and their genre.\n"
        f"2. Provide an image URL (band photo or album cover) from a reputable source.\n\n"
        f"IMPORTANT: If you have no reliable knowledge of this specific music act (e.g. they are a small\n"
        f"local or regional band you cannot verify), return description = '' and image_url = '' rather\n"
        f"than guessing. Do NOT describe a place, concept, or non-music entity with the same name.\n"
        f"Do NOT fabricate image URLs.\n\n"
        f"Return ONLY a JSON object with exactly these keys:\n"
        f"  description : string (empty string if unknown)\n"
        f"  image_url   : string (image URL or empty string if unknown)\n\n"
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


def save_cache(results, suffix=''):
    path = CACHE_FILE.replace('.json', f'{suffix}.json') if suffix else CACHE_FILE
    with open(path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"  [CACHE] Saved to {path}")


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

def purge_venue_events(cursor, venue_id):
    """Delete all events for a venue. Returns the number of rows deleted."""
    cursor.execute("DELETE FROM events WHERE venue_id=%s", (venue_id,))
    return cursor.rowcount


def insert_events(phase3_results):
    """
    Purge then re-insert events for each venue.
    The scraper output is the source of truth — stale events are removed first.
    Returns (inserted_count, purged_count, failed_count).
    """
    db = get_db_connection(DB_NAME)
    cursor = db.cursor()
    inserted = 0
    purged = 0
    failed = 0

    try:
        for venue_result in phase3_results:
            venue_id = venue_result['venue_id']
            venue_name = venue_result['venue_name']
            events = venue_result.get('events', [])
            if not events:
                continue

            deleted = purge_venue_events(cursor, venue_id)
            purged += deleted
            print(f"  [{venue_id}] {venue_name}: purged {deleted} old events")

            for event in events:
                band_id = event.get('band_id')
                if band_id is None:
                    failed += 1
                    continue

                event_date = event.get('event_date', '')
                event_time = event.get('event_time', '20:00:00')
                event_price = event.get('event_price', 0)

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

    return inserted, purged, failed


def run_phase4(phase3_results):
    """
    Phase 4 entry point.
    Purges then re-inserts events per venue, then regenerates publish.json.
    Returns (inserted, purged, failed) counts.
    """
    print("=" * 60)
    print("PHASE 4: Event Insert & publish.json Regeneration")
    print("=" * 60)

    inserted, purged, failed = insert_events(phase3_results)
    print(f"\nEvent inserts:")
    print(f"  Purged   : {purged}")
    print(f"  Inserted : {inserted}")
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

    return inserted, purged, failed


# ---------------------------------------------------------------------------
# Phase 5: Alerting & full-pipeline orchestration
# ---------------------------------------------------------------------------

def send_alert_email(subject, body):
    """
    Send a summary email to ALERT_EMAIL if configured in .env.
    Supports plain SMTP on port 25 or authenticated STARTTLS (set SMTP_USER/SMTP_PASS).
    """
    if not ALERT_EMAIL:
        return
    try:
        import email.mime.text
        msg = email.mime.text.MIMEText(body)
        msg['Subject'] = f'[WhatUpSF Scraper] {subject}'
        msg['From']    = SMTP_FROM or ALERT_EMAIL
        msg['To']      = ALERT_EMAIL
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            if SMTP_USER and SMTP_PASS:
                s.starttls()
                s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(msg['From'], [ALERT_EMAIL], msg.as_string())
        print(f"  [ALERT] Summary email sent to {ALERT_EMAIL}")
    except Exception as e:
        print(f"  [ALERT ERROR] Could not send email: {e}")


def run_full_pipeline():
    """
    Orchestrate phases 2-4, collect per-venue errors, and send an alert email
    with the run summary.
    """
    started_at = datetime.datetime.now()
    print(f"\n{'=' * 60}")
    print(f"WhatUpSF Scraper  —  {started_at.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'=' * 60}\n")

    pipeline_error = None
    inserted = skipped = failed_events = 0
    venue_errors = []

    try:
        phase2_results, venue_errors = run_phase2()
        phase3_results = run_phase3(phase2_results)
        inserted, purged_events, failed_events = run_phase4(phase3_results)
    except Exception as exc:
        pipeline_error = exc
        print(f"\n[PIPELINE ERROR] {exc}")
        traceback.print_exc()

    elapsed = datetime.datetime.now() - started_at
    status = 'FAILED' if pipeline_error or venue_errors else 'OK'

    # Build alert body
    lines = [
        f"Run started : {started_at.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Elapsed     : {elapsed}",
        f"Status      : {status}",
        "",
        f"Events purged   : {purged_events}",
        f"Events inserted : {inserted}",
        f"Events failed   : {failed_events}  (missing band_id)",
    ]
    if venue_errors:
        lines += ["", f"Venue errors ({len(venue_errors)}):"]
        for vid, vname, err in venue_errors:
            lines.append(f"  [{vid}] {vname}: {err}")
    if pipeline_error:
        lines += ["", f"Pipeline exception:", f"  {pipeline_error}"]

    body = "\n".join(lines)
    print(f"\n{'=' * 60}")
    print(body)
    print(f"{'=' * 60}\n")

    subject = f"{status} — {inserted} events inserted, {len(venue_errors)} venue errors"
    send_alert_email(subject, body)

    if pipeline_error:
        sys.exit(1)


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
            if is_non_music_act(band_name):
                # Explicitly clear any existing media_url for non-music acts
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


def backfill_enrichment(venue_id=None):
    """
    Re-run full AI enrichment (description, image_url, media_url) for bands.
    If venue_id is given, only bands with events at that venue are processed.
    """
    db = get_db_connection(DB_NAME)
    cursor = db.cursor()
    try:
        if venue_id:
            cursor.execute("""
                SELECT DISTINCT B.id, B.name FROM bands B
                JOIN events E ON E.band_id = B.id
                WHERE E.venue_id = %s
            """, (venue_id,))
        else:
            cursor.execute("SELECT id, name FROM bands")
        bands = cursor.fetchall()
    finally:
        db.close()

    print(f"Re-enriching {len(bands)} bands{f' for venue {venue_id}' if venue_id else ''}...")
    updated = 0
    for band_id, band_name in bands:
        if is_non_music_act(band_name):
            print(f"  [SKIP] Non-music act: '{band_name}'")
            continue
        print(f"  [{band_id}] {band_name}")
        enrichment = enrich_band_with_ai(band_name)
        db = get_db_connection(DB_NAME)
        cursor = db.cursor()
        try:
            cursor.execute(
                "UPDATE bands SET media_url=%s, image_url=%s, descriptions=%s WHERE id=%s",
                (enrichment['media_url'], enrichment['image_url'], enrichment['description'], band_id),
            )
            db.commit()
            updated += 1
            print(f"    media={enrichment['media_url'] or '(none)'}  img={enrichment['image_url'] or '(none)'}")
        except Exception as e:
            print(f"    [DB ERROR] {e}")
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
                        help='Run against a single venue by ID (all phases); use --phase to stop early')
    parser.add_argument('--debug', action='store_true',
                        help='Enable verbose debug logging')
    parser.add_argument('--backfill-media', action='store_true',
                        help='Fill in missing media_url for bands in DB via YouTube search')
    parser.add_argument('--backfill-media-all', action='store_true',
                        help='Redo media_url for ALL bands via YouTube search (overwrites existing)')
    parser.add_argument('--dump-only', action='store_true',
                        help='Just regenerate publish.json from current DB state (no scraping)')
    parser.add_argument('--backfill-enrichment', action='store_true',
                        help='Re-run full AI enrichment (description, image_url, media_url) for bands; use with --venue to scope to one venue')
    parser.add_argument('--no-log', action='store_true',
                        help='Skip writing to a log file (useful for interactive debugging)')
    args = parser.parse_args()

    if args.debug:
        globals()['DEBUG'] = True

    # Logging: full pipeline runs always write to logs/; interactive modes skip unless forced
    _is_full_run = (args.phase is None and not args.venue and not args.dump_only
                    and not args.backfill_media and not getattr(args, 'backfill_media_all', False)
                    and not args.backfill_enrichment)
    if _is_full_run and not args.no_log:
        log_path = setup_logging()
        print(f"Logging to: {log_path}")

    phase = args.phase  # None means run all phases

    if args.backfill_enrichment:
        backfill_enrichment(venue_id=args.venue)
        sys.exit(0)

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
        if phase == 1:
            sys.exit(0)
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

        if phase == 2:
            sys.exit(0)

        if not events:
            print("\n  No events to insert.")
            sys.exit(0)

        venue_result = [{'venue_id': vid, 'venue_name': vname, 'calendar_url': cal_url, 'events': events}]
        band_cache, new_band_ids = {}, set()
        for event in events:
            band_name = event.get('band_name', '').strip()
            if band_name:
                event['band_id'] = lookup_or_create_band(band_name, band_cache, new_band_ids)
        print(f"\n  Bands: {len(new_band_ids)} new, {len(band_cache) - len(new_band_ids)} existing")
        save_cache(venue_result, suffix=f'_{vid}')

        if phase == 3:
            sys.exit(0)

        run_phase4(venue_result)
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
        phase2_results, _ = run_phase2()
        run_phase3(phase2_results)
    elif phase == 4:
        # Load from cache — no need to re-scrape
        results = load_cache()
        run_phase4(results)
    else:
        # No --phase specified: run full pipeline
        run_full_pipeline()
