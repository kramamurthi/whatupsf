#!/bin/bash
# Restart the whatupsf gunicorn server if it is not running.
# Run from cron every 5 minutes.
set -u

PROJECT_DIR=/home/kriram5/whatupsf.com/whatupsf
VENV=/home/kriram5/whatupsf.com/venv
PIDFILE=/home/kriram5/gunicorn_whatupsf.pid
ACCESS_LOG=/home/kriram5/gunicorn_access.log
ERROR_LOG=/home/kriram5/gunicorn_error.log
BIND=173.236.219.130:8000

# Live pid from our pidfile: nothing to do.
if [ -f "$PIDFILE" ]; then
    if kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
        exit 0
    fi
    rm -f "$PIDFILE"
fi

# Catch a gunicorn started outside this script (e.g. by hand) so we don't
# start a second one and fight over the port. Test the port rather than
# pattern-matching process names: a pgrep pattern broad enough to find
# gunicorn also matches this script's own command line, which is how the
# previous version of this watchdog silently never fired.
if timeout 5 bash -c "< /dev/tcp/${BIND%:*}/${BIND##*:}" 2>/dev/null; then
    exit 0
fi

echo "[$(date '+%F %T %z')] watchdog: gunicorn not running, starting it" >> "$ERROR_LOG"

cd "$PROJECT_DIR" || exit 1
exec "$VENV/bin/gunicorn" \
    --bind "$BIND" \
    --workers 1 \
    --pid "$PIDFILE" \
    --daemon \
    --access-logfile "$ACCESS_LOG" \
    --error-logfile "$ERROR_LOG" \
    config.wsgi:application
