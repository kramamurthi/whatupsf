/**
 * Dock — the control surface under the city window.
 *
 * It is deliberately not a popup or a floating card: it shares an edge with the map frame and
 * stays in exactly one place, so event context appears where you already know to look instead
 * of chasing a marker around the screen.
 *
 * The dock is dumb. It renders whatever context it is handed and reports taps upward; deciding
 * what the context should be is the app's job.
 */
export class Dock {
    /**
     * @param {HTMLElement} host
     * @param {Object} handlers {onPrev, onToggle, onNext, onInfo}
     */
    constructor({ host, handlers = {} }) {
        this.host = host;
        this.handlers = handlers;
        this._build();
    }

    _build() {
        this.host.innerHTML = `
            <button class="dock__context" type="button">
                <span class="dock__eyebrow"></span>
                <span class="dock__title"></span>
                <span class="dock__sub"></span>
            </button>
            <div class="dock__transport">
                <span class="dock__spacer" aria-hidden="true"></span>
                <div class="dock__keys">
                <button class="dock__btn dock__btn--side" type="button" data-act="prev" aria-label="Previous">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14L8 12l9-7z"/><rect x="6" y="5" width="1.6" height="14" rx="0.8"/></svg>
                </button>
                <button class="dock__btn dock__btn--play" type="button" data-act="toggle" aria-label="Play">
                    <svg class="dock__icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>
                    <svg class="dock__icon-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>
                </button>
                <button class="dock__btn dock__btn--side" type="button" data-act="next" aria-label="Next">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l9-7-9-7z"/><rect x="16.4" y="5" width="1.6" height="14" rx="0.8"/></svg>
                </button>
                </div>
                <button class="dock__live" type="button" aria-label="Show what is happening now">
                    <i class="dock__live-dot"></i><span>LIVE NOW</span>
                </button>
            </div>
            <div class="dock__credit">via YouTube</div>
            <div class="dock__player" aria-hidden="true"><div id="yt-host"></div></div>
        `;

        this.eyebrowEl = this.host.querySelector('.dock__eyebrow');
        this.titleEl = this.host.querySelector('.dock__title');
        this.subEl = this.host.querySelector('.dock__sub');
        this.playBtn = this.host.querySelector('.dock__btn--play');
        this.playerHost = this.host.querySelector('#yt-host');

        this.host.querySelector('[data-act="prev"]').addEventListener('click', () => this.handlers.onPrev?.());
        this.host.querySelector('[data-act="next"]').addEventListener('click', () => this.handlers.onNext?.());
        this.playBtn.addEventListener('click', () => this.handlers.onToggle?.());
        this.host.querySelector('.dock__context').addEventListener('click', () => this.handlers.onInfo?.());
        this.liveBtn = this.host.querySelector('.dock__live');
        this.liveBtn.addEventListener('click', () => this.handlers.onLive?.());

        // Keep dock gestures off the map underneath.
        if (window.L?.DomEvent) {
            L.DomEvent.disableClickPropagation(this.host);
            L.DomEvent.disableScrollPropagation(this.host);
        }
    }

    /** @param {Object} ctx {eyebrow, title, sub} */
    setContext(ctx) {
        if (!ctx) return;
        // Fade the text rather than swapping it instantly, so walking the jukebox reads as
        // one continuous object changing rather than a flicker of unrelated labels.
        this.host.classList.add('is-swapping');
        window.setTimeout(() => {
            this.eyebrowEl.textContent = ctx.eyebrow || '';
            this.titleEl.textContent = ctx.title || '';
            this.subEl.textContent = ctx.sub || '';
            this.host.classList.remove('is-swapping');
        }, 90);
    }

    /** Reflect whether the city is showing the present moment or a scrubbed time. */
    setLive(isLive) {
        this.liveBtn.classList.toggle('is-live', !!isLive);
        this.liveBtn.setAttribute('aria-pressed', String(!!isLive));
    }

    setPlaying(playing) {
        this.host.classList.toggle('is-playing', !!playing);
        this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    setEnabled(enabled) {
        this.host.classList.toggle('is-empty', !enabled);
        this.host.querySelectorAll('.dock__btn').forEach((b) => { b.disabled = !enabled; });
    }
}
