#!/bin/bash
# Health digest for whatupsf.com.
#
# Prints nothing when everything is healthy, so the cron job only generates mail
# (via MAILTO in the crontab) when there is something worth reading. Pass
# --heartbeat to always print, which is how the weekly "still watching" mail
# works: silence from a daily-only check is ambiguous, because a check that has
# itself broken also stays silent.
set -u

URL=https://whatupsf.com/
NGINX_LOGS=/home/_domain_logs/kriram5/whatupsf.com
GUNICORN_LOG=/home/kriram5/gunicorn_error.log
HOURS=24

heartbeat=0
[ "${1:-}" = "--heartbeat" ] && heartbeat=1

# nginx error logs use "2026/08/06 01:17:49"; our watchdog lines use
# "[2026-08-08 10:15:01 -0700]". Both sort lexicographically, so a string
# compare against a formatted cutoff is enough to window them.
cutoff_slash=$(date -d "$HOURS hours ago" '+%Y/%m/%d %H:%M:%S')
cutoff_dash=$(date -d "$HOURS hours ago" '+%Y-%m-%d %H:%M:%S')

# 1. Is the site actually serving right now?
status=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -L "$URL" 2>/dev/null)

# 2. nginx failures reaching gunicorn. Yesterday's file is included because the
#    24h window spans a rotation; zcat -f reads plain and gzipped alike.
yesterday=$(date -d yesterday +%F)
refused=$(zcat -f $NGINX_LOGS/*/error.log $NGINX_LOGS/*/error.log."$yesterday"* 2>/dev/null \
    | awk -v c="$cutoff_slash" '/Connection refused/ && ($1" "$2) >= c' | wc -l)

# 3. Times the watchdog had to bring gunicorn back.
restarts=$(grep -h 'watchdog: gunicorn not running' "$GUNICORN_LOG" 2>/dev/null \
    | sed 's/^\[//' | awk -v c="$cutoff_dash" '($1" "$2) >= c' | wc -l)

problem=0
[ "$status" != "200" ] && problem=1
[ "$refused" -gt 0 ] && problem=1
[ "$restarts" -gt 0 ] && problem=1

[ $problem -eq 0 ] && [ $heartbeat -eq 0 ] && exit 0

if [ "$status" != "200" ]; then
    echo "*** whatupsf.com IS DOWN RIGHT NOW: $URL returned '$status' (expected 200) ***"
    echo "The watchdog could not fix this on its own. Log in and investigate."
    echo
elif [ $problem -eq 1 ]; then
    echo "whatupsf.com is up now, but had trouble in the last ${HOURS}h."
    echo
else
    echo "whatupsf.com weekly heartbeat: healthy, nothing to report."
    echo
fi

echo "  site responding now : $status"
echo "  gunicorn restarts   : $restarts  (watchdog had to start it)"
echo "  nginx 502s upstream : $refused  (requests that got Bad Gateway)"
echo

if [ "$restarts" -gt 0 ]; then
    echo "Recent watchdog restarts:"
    grep -h 'watchdog: gunicorn not running' "$GUNICORN_LOG" 2>/dev/null | tail -10 | sed 's/^/  /'
    echo
fi

if [ "$refused" -gt 0 ]; then
    echo "Most recent upstream failures seen by nginx:"
    zcat -f $NGINX_LOGS/*/error.log 2>/dev/null | grep 'Connection refused' \
        | tail -3 | cut -c1-160 | sed 's/^/  /'
    echo
fi

echo "Check:  ps -ef | grep config.wsgi        (is gunicorn alive?)"
echo "Logs :  tail -50 $GUNICORN_LOG"
echo "Start:  /home/kriram5/whatupsf.com/whatupsf/bin/gunicorn_watchdog.sh"
