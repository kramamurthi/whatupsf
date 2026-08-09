/**
 * TimeSlider — a 45-minute-step scrubber pinned along the bottom of the map.
 *
 * A festival stage runs seven or more acts in a day, which is unreadable in a popup on a
 * phone. The map therefore shows one act per stage, and this control decides which moment
 * "one act" is relative to. It starts on the current time, so tapping a stage answers
 * "what is on there right now" without touching the slider at all.
 */

const STEP = 45;   // minutes per notch

/** Format minutes-since-midnight as "4 PM" / "4:45 PM". */
export function formatClock(minutes) {
    const h24 = Math.floor(minutes / 60) % 24;
    const m = Math.round(minutes) % 60;
    const suffix = h24 < 12 ? 'AM' : 'PM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Minutes since midnight, in San Francisco, regardless of where the visitor is. */
export function nowMinutesSF() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    return (get('hour') % 24) * 60 + get('minute');
}

export class TimeSlider {
    /**
     * @param {number} startHour  first selectable hour (0-23)
     * @param {number} endHour    last selectable hour (24 = midnight)
     * @param {Function} onChange called whenever the effective time changes
     */
    constructor({ startHour, endHour, onChange }) {
        this.startMin = startHour * 60;
        this.endMin = endHour * 60;
        this.onChange = onChange || (() => {});

        // Whether the user has taken manual control. Tracked explicitly rather than
        // inferred from the value: the clock keeps moving, and a visitor who has not
        // touched anything should stay on "now" rather than silently drift into a
        // custom time as the minutes pass.
        this.scrubbed = false;
        this.minutes = this.nowSlot();

        this._build();
        // Follow the clock while untouched, so a page left open at the festival keeps
        // answering "what is on now" instead of freezing at the load time.
        this.ticker = setInterval(() => this._tick(), 30000);
    }

    /** The notch that best represents the current time, clamped into range. */
    nowSlot() {
        const now = nowMinutesSF();
        const clamped = Math.min(Math.max(now, this.startMin), this.endMin);
        return this.startMin + Math.round((clamped - this.startMin) / STEP) * STEP;
    }

    /** The time the map should reflect: the real clock unless the user has scrubbed. */
    getMinutes() {
        return this.scrubbed ? this.minutes : nowMinutesSF();
    }

    /** False once the user has chosen their own time. */
    isNow() {
        return !this.scrubbed;
    }

    _build() {
        const wrap = document.createElement('div');
        wrap.className = 'time-slider';
        wrap.innerHTML = `
            <div class="time-slider__head">
                <span class="time-slider__value"></span>
                <span class="time-slider__now">NOW</span>
                <button class="time-slider__reset" type="button">What's up now</button>
            </div>
            <input class="time-slider__input" type="range"
                   min="${this.startMin}" max="${this.endMin}" step="${STEP}" value="${this.minutes}"
                   aria-label="Choose a time of day">
            <div class="time-slider__scale">
                <span>${formatClock(this.startMin)}</span>
                <span class="time-slider__clock"></span>
                <span>${formatClock(this.endMin)}</span>
            </div>
        `;
        document.body.appendChild(wrap);
        document.body.classList.add('has-time-slider');

        this.el = wrap;
        this.input = wrap.querySelector('.time-slider__input');
        this.valueEl = wrap.querySelector('.time-slider__value');
        this.nowEl = wrap.querySelector('.time-slider__now');
        this.resetEl = wrap.querySelector('.time-slider__reset');
        this.clockEl = wrap.querySelector('.time-slider__clock');

        // Leaflet would otherwise treat a drag across the control as a map gesture.
        if (window.L?.DomEvent) {
            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.disableScrollPropagation(wrap);
        }

        this.input.addEventListener('input', () => {
            this.minutes = parseInt(this.input.value, 10);
            this.scrubbed = true;
            this._paint();
            this.onChange();
        });

        this.resetEl.addEventListener('click', () => {
            this.scrubbed = false;
            this.minutes = this.nowSlot();
            this.input.value = this.minutes;
            this._paint();
            this.onChange();
        });

        this._paint();
        window.addEventListener('resize', () => this._publishHeight());
    }

    /**
     * Publish our height so Leaflet's bottom controls can clear us. A fixed offset goes
     * stale the moment this bar gains a row — which is exactly how the locate button
     * ended up buried underneath it.
     */
    _publishHeight() {
        const h = Math.ceil(this.el.getBoundingClientRect().height);
        document.documentElement.style.setProperty('--time-slider-h', `${h}px`);
    }

    /** Keep the displayed clock — and, if untouched, the thumb — in step with real time. */
    _tick() {
        if (!this.scrubbed) {
            const slot = this.nowSlot();
            if (slot !== this.minutes) {
                this.minutes = slot;
                this.input.value = slot;
            }
            this._paint();
            this.onChange();
        } else {
            this._paint();
        }
    }

    _paint() {
        const live = this.isNow();
        this.valueEl.textContent = formatClock(this.getMinutes());
        this.nowEl.style.display = live ? '' : 'none';
        this.resetEl.style.display = live ? 'none' : '';
        this.clockEl.textContent = `SF now · ${formatClock(nowMinutesSF())}`;
        this._publishHeight();
    }
}
