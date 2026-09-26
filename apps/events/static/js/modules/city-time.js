/**
 * CityTime — the vertical rail that answers "what time in San Francisco am I looking at?"
 *
 * This is city time, not music time. It never seeks playback and never changes the current
 * track. It only decides which slice of the evening the map is showing.
 *
 * Earlier times sit at the top of the rail and later times at the bottom, so dragging down
 * moves the city forward through the night.
 */

const HOUR = 60;
const DAY = 24 * HOUR;

// The evening window the rail covers: 5pm through 1am. Tonight's listings run 7:00–11:30pm,
// so this frames the data with headroom on both sides without wasting rail on dead daytime.
export const RAIL_START = 17 * HOUR;   // 5 PM
export const RAIL_END = 25 * HOUR;     // 1 AM (next day, on a continuous scale)
const STEP = 15;

// Anything before 6am belongs to the previous evening as far as nightlife is concerned, so it
// lives at the top of the continuous scale rather than wrapping back to the start of the day.
// Without this, a 12:30 AM set sorts before a 7 PM one and the whole rail reads backwards.
const WRAP_BEFORE = 6 * HOUR;

/** Put a minutes-since-midnight value onto the rail's continuous evening scale. */
export function toCityMinutes(minutes) {
    if (minutes === null || minutes === undefined) return null;
    return minutes < WRAP_BEFORE ? minutes + DAY : minutes;
}

/** Format a scale value as "8 PM" / "8:15 PM". */
export function formatClock(minutes) {
    const h24 = Math.floor(minutes / HOUR) % 24;
    const m = Math.round(minutes) % HOUR;
    const suffix = h24 < 12 ? 'AM' : 'PM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Minutes since midnight in San Francisco, wherever the visitor happens to be. */
export function nowMinutesSF() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    return (get('hour') % 24) * HOUR + get('minute');
}

/** The real clock, on the rail's scale. */
export function nowCityMinutes() {
    return toCityMinutes(nowMinutesSF());
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export class CityTime {
    /** @param {HTMLElement} host  element the rail is built into
     *  @param {Function} onChange called whenever the effective city time changes */
    constructor({ host, onChange }) {
        this.host = host;
        this.onChange = onChange || (() => {});

        // Tracked explicitly rather than inferred from the value. The clock keeps moving, and
        // someone who has not touched the rail should stay pinned to "now" instead of quietly
        // becoming a custom time as the minutes pass.
        this.scrubbed = false;
        this.minutes = this.nowSlot();

        this._build();
        this.ticker = setInterval(() => this._tick(), 30000);
    }

    /** Nearest step to the real clock, clamped onto the rail. */
    nowSlot() {
        const snapped = Math.round(nowCityMinutes() / STEP) * STEP;
        return clamp(snapped, RAIL_START, RAIL_END);
    }

    /**
     * The time the map should reflect. Untouched, that is the true clock — not the rounded
     * rail position, which can sit in the wrong 15-minute slot and mislabel a live set.
     */
    getMinutes() {
        return this.scrubbed ? this.minutes : nowCityMinutes();
    }

    isNow() {
        return !this.scrubbed;
    }

    goToNow() {
        this.scrubbed = false;
        this.minutes = this.nowSlot();
        this._paint();
        this.onChange();
    }

    // --- internals ---------------------------------------------------------------

    _build() {
        this.host.innerHTML = `
            <div class="rail__track" role="slider" tabindex="0"
                 aria-label="City time"
                 aria-valuemin="${RAIL_START}" aria-valuemax="${RAIL_END}">
                <div class="rail__line"></div>
                <div class="rail__ticks"></div>
                <div class="rail__nowmark" aria-hidden="true"></div>
                <div class="rail__thumb"><span class="rail__chip"></span></div>
            </div>
        `;

        this.track = this.host.querySelector('.rail__track');
        this.thumb = this.host.querySelector('.rail__thumb');
        this.chip = this.host.querySelector('.rail__chip');
        this.nowMark = this.host.querySelector('.rail__nowmark');

        // Hour labels, drawn once.
        const ticks = this.host.querySelector('.rail__ticks');
        for (let m = RAIL_START; m <= RAIL_END; m += HOUR) {
            const tick = document.createElement('div');
            tick.className = 'rail__tick';
            tick.style.top = `${this._fraction(m) * 100}%`;
            tick.innerHTML = `<i></i><b>${formatClock(m)}</b>`;
            ticks.appendChild(tick);
        }

        // Pointer events rather than a range input: a vertical <input type=range> cannot be
        // styled consistently across browsers, and it would read as a volume slider.
        const toValue = (clientY) => {
            const box = this.track.getBoundingClientRect();
            const f = clamp((clientY - box.top) / box.height, 0, 1);
            return RAIL_START + Math.round((f * (RAIL_END - RAIL_START)) / STEP) * STEP;
        };
        const drag = (e) => {
            const next = toValue(e.clientY);
            if (next !== this.minutes || !this.scrubbed) {
                this.minutes = next;
                this.scrubbed = true;
                this._paint();
                this.onChange();
            }
        };

        this.track.addEventListener('pointerdown', (e) => {
            this.track.setPointerCapture(e.pointerId);
            this.track.classList.add('is-dragging');
            drag(e);
            e.preventDefault();
        });
        this.track.addEventListener('pointermove', (e) => {
            if (this.track.hasPointerCapture(e.pointerId)) drag(e);
        });
        const end = (e) => {
            this.track.classList.remove('is-dragging');
            if (this.track.hasPointerCapture?.(e.pointerId)) this.track.releasePointerCapture(e.pointerId);
        };
        this.track.addEventListener('pointerup', end);
        this.track.addEventListener('pointercancel', end);

        this.track.addEventListener('keydown', (e) => {
            const delta = { ArrowUp: -STEP, ArrowDown: STEP, PageUp: -HOUR, PageDown: HOUR }[e.key];
            if (delta === undefined) return;
            this.minutes = clamp(this.minutes + delta, RAIL_START, RAIL_END);
            this.scrubbed = true;
            this._paint();
            this.onChange();
            e.preventDefault();
        });

        this._paint();
    }

    /** Where a scale value sits down the rail, 0 at the top. */
    _fraction(minutes) {
        return (clamp(minutes, RAIL_START, RAIL_END) - RAIL_START) / (RAIL_END - RAIL_START);
    }

    _tick() {
        if (!this.scrubbed) {
            this.minutes = this.nowSlot();
            this._paint();
            this.onChange();
        } else {
            this._paint();
        }
    }

    _paint() {
        const effective = this.getMinutes();
        this.thumb.style.top = `${this._fraction(this.scrubbed ? this.minutes : effective) * 100}%`;
        this.chip.textContent = formatClock(clamp(effective, RAIL_START, RAIL_END));
        this.nowMark.style.top = `${this._fraction(this.nowSlot()) * 100}%`;
        this.host.classList.toggle('is-live', !this.scrubbed);
        this.track.setAttribute('aria-valuenow', String(Math.round(effective)));
        this.track.setAttribute('aria-valuetext', formatClock(clamp(effective, RAIL_START, RAIL_END)));
    }
}
