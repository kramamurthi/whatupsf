/**
 * StagePanel — a fixed readout of the selected stage, parked in the dimmed map space
 * above Golden Gate Park.
 *
 * Anchored Leaflet popups do not work for the festival view. A popup hangs off its marker,
 * so it fights the header, the screen edges and the slider, and Leaflet's autoPan tries to
 * shove the map to make room — on a view that is deliberately pinned to the park. It also
 * covers the very markers you are trying to move between.
 *
 * Since the festival view already dims everything outside the park, that band along the
 * top is dead space. Putting the readout there gives it a stable home: nothing moves, the
 * park stays visible, and tapping from stage to stage just swaps the contents.
 */
export class StagePanel {
    constructor({ onClose } = {}) {
        this.onClose = onClose || (() => {});
        this.venue = null;
        this._build();
    }

    _build() {
        const el = document.createElement('div');
        el.className = 'stage-panel';
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = `
            <button class="stage-panel__close" aria-label="Close">&times;</button>
            <div class="stage-panel__title"></div>
            <div class="stage-panel__body"></div>
        `;
        document.body.appendChild(el);

        this.el = el;
        this.titleEl = el.querySelector('.stage-panel__title');
        this.bodyEl = el.querySelector('.stage-panel__body');

        // Keep taps on the panel from reaching the map underneath.
        if (window.L?.DomEvent) {
            L.DomEvent.disableClickPropagation(el);
            L.DomEvent.disableScrollPropagation(el);
        }

        el.querySelector('.stage-panel__close').addEventListener('click', () => {
            this.hide();
            this.onClose();
        });
    }

    /** Show a stage. `bodyHtml` is the already-rendered single-act markup. */
    show(venue, bodyHtml) {
        this.venue = venue;
        this.titleEl.innerHTML = venue.url
            ? `<a href="http://${venue.url}" target="_blank" rel="noopener">${venue.venue}</a>`
            : venue.venue;
        this.bodyEl.innerHTML = bodyHtml;
        this.el.classList.add('is-open');
    }

    /** Re-render the current stage — used when the time slider moves. */
    update(bodyHtml) {
        if (this.venue) this.bodyEl.innerHTML = bodyHtml;
    }

    hide() {
        this.venue = null;
        this.el.classList.remove('is-open');
        this.bodyEl.innerHTML = '';
    }

    isOpen() {
        return this.el.classList.contains('is-open');
    }
}
