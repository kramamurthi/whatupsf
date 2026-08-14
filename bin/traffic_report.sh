#!/bin/bash
# Traffic report for whatupsf.com, built from the nginx access logs.
#
# The app keeps no analytics of its own, but nginx logs every request and the
# host rotates roughly a week of them. That is enough to answer "did anyone
# actually visit" without adding a tracker to the site.
#
#   traffic_report.sh                     daily table, today by hour, top pages
#   traffic_report.sh --days 3            limit the daily table
#   traffic_report.sh --date 2026-08-08   break that day down by hour instead
#
# Read visitors (unique IPs), not requests: one visitor pulls a dozen static
# assets per page load, and a browser-automation run can add thousands.
set -u

PYTHON=/home/kriram5/whatupsf.com/venv/bin/python
# Go through the symlinks in ~/logs rather than /home/_domain_logs directly —
# the numeric directory ids on the far side change when the host re-provisions.
LOGS=/home/kriram5/logs/whatupsf.com

DAYS=7
DATE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --days) DAYS="${2:-7}"; shift 2 ;;
        --date) DATE="${2:-}"; shift 2 ;;
        -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

[ -d "$LOGS" ] || { echo "No log directory at $LOGS" >&2; exit 1; }

DAYS="$DAYS" DATE="$DATE" LOGS="$LOGS" "$PYTHON" - <<'PY'
import collections, glob, gzip, os, re, sys

LOGS = os.environ['LOGS']
DAYS = int(os.environ['DAYS'])
ONLY = os.environ['DATE'].strip()

# Combined log format: ip - - [09/Aug/2026:11:48:09 -0700] "GET /p HTTP/1.1" 200 12 "ref" "ua"
LINE = re.compile(
    r'^(\S+).*?\[(\d{2})/(\w{3})/(\d{4}):(\d{2}):\d{2}:\d{2}[^\]]*\]\s+'
    r'"(\w+)\s+(\S+)[^"]*"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"'
)
# Headless browsers count as bots: an automated test run is not an audience,
# and it can dwarf real traffic for a day.
BOT = re.compile(r'bot|crawl|spider|slurp|bing|yandex|baidu|ahrefs|semrush|'
                 r'facebookexternal|headless|python-requests|curl|wget|scan|'
                 r'censys|expanse|paloalto|zgrab|masscan', re.I)
STATIC = re.compile(r'\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map|webp)(\?|$)', re.I)
MONTHS = {m: i + 1 for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}


def hits():
    """Yield parsed requests from every http/https log, plain or gzipped."""
    # Rotation leaves alias symlinks beside the real files (access.log.0 ->
    # access.log.2026-08-08), so a naive glob reads yesterday twice and doubles it.
    # Resolve everything and keep one entry per actual file.
    seen, paths = set(), []
    for path in sorted(glob.glob(f'{LOGS}/*/access.log') + glob.glob(f'{LOGS}/*/access.log.*')):
        real = os.path.realpath(path)
        if real not in seen:
            seen.add(real)
            paths.append(path)
    if not paths:
        sys.exit(f'No access logs found under {LOGS}')
    for path in paths:
        opener = gzip.open if path.endswith('.gz') else open
        try:
            with opener(path, 'rt', errors='replace') as fh:
                for line in fh:
                    m = LINE.match(line)
                    if not m:
                        continue
                    ip, d, mon, yr, hh, _meth, url, status, _b, ref, ua = m.groups()
                    if mon not in MONTHS:
                        continue
                    yield {
                        'day': f'{yr}-{MONTHS[mon]:02d}-{int(d):02d}',
                        'hour': hh, 'ip': ip, 'path': url.split('?')[0],
                        'status': status, 'ref': ref,
                        'bot': bool(BOT.search(ua)) or ua in ('', '-'),
                        'page': not STATIC.search(url),
                    }
        except OSError as exc:
            print(f'  [skip] {path}: {exc}', file=sys.stderr)


def blank():
    return {'req': 0, 'human': 0, 'bot': 0, 'visitors': set(), 'pages': 0}


daily = collections.defaultdict(blank)
hourly = collections.defaultdict(blank)
pages, refs, errors = collections.Counter(), collections.Counter(), collections.Counter()

for r in hits():
    for bucket in (daily[r['day']], hourly[(r['day'], r['hour'])]):
        bucket['req'] += 1
        bucket['bot' if r['bot'] else 'human'] += 1
        if not r['bot']:
            bucket['visitors'].add(r['ip'])
            if r['page']:
                bucket['pages'] += 1
    if not r['bot'] and r['page']:
        pages[r['path']] += 1
        if r['ref'] not in ('', '-') and 'whatupsf' not in r['ref']:
            refs[r['ref'][:58]] += 1
    if r['status'].startswith('5'):
        errors[r['day']] += 1

if not daily:
    sys.exit('No parseable requests found.')

recent = sorted(daily)[-DAYS:]
focus = ONLY or sorted(daily)[-1]

print('=' * 78)
print('whatupsf.com traffic')
print('=' * 78)
print(f"{'date':<12}{'requests':>10}{'human':>9}{'bots':>8}{'visitors':>10}{'pageviews':>11}{'5xx':>6}")
for day in recent:
    d = daily[day]
    print(f"{day:<12}{d['req']:>10}{d['human']:>9}{d['bot']:>8}"
          f"{len(d['visitors']):>10}{d['pages']:>11}{errors.get(day, 0):>6}")

print()
print(f'By hour — {focus}')
print('-' * 78)
same_day = [k for k in hourly if k[0] == focus]
if not same_day:
    print('  (no requests logged for that date)')
else:
    peak = max(hourly[k]['human'] for k in same_day) or 1
    for key in sorted(same_day):
        h = hourly[key]
        bar = '#' * int(38 * h['human'] / peak)
        print(f"  {key[1]}:00 {h['req']:>7} req {h['human']:>6} human "
              f"{len(h['visitors']):>4} visitors  {bar}")

print()
print('Top pages (human):')
for path, n in pages.most_common(8):
    print(f'  {n:>6}  {path[:62]}')

print()
print('Top external referrers:')
for ref, n in refs.most_common(6) or [('(none)', 0)]:
    print(f'  {n:>6}  {ref}')

print()
print('"visitors" = distinct non-bot IPs, the closest thing to a real audience')
print('figure available here. Requests include static assets and inflate easily.')
PY
