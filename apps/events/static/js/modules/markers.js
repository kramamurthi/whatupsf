/**
 * Marker language for the citywide view.
 *
 * Markers stay secondary to the city until you choose one. There is a single warm accent for
 * "happening now" and cool neutrals for everything else — states are separated by weight, fill
 * and opacity rather than by adding more colours, which leaves room for category or popularity
 * later without redesigning the palette.
 *
 * Radii are in pixels rather than metres. That is only safe because the citywide view has a
 * fixed zoom; if zoom ever becomes variable again these need to scale.
 */
import { toCityMinutes } from './city-time.js';

// How long a set is assumed to run when nothing follows it, so the last act of the night still
// reads as live for a sensible while.
const ASSUMED_SET_MINUTES = 90;

const INK = {
    quiet: '#525c6b',
    upcoming: '#9db2cd',
    live: '#ff7a45',
    selectedCore: '#fff1e8',
};

/** Parse publish.json's "8:00 PM" into minutes since midnight, or null. */
export function parseClockToMinutes(text) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(text || '');
    if (!m) return null;
    const hour = (parseInt(m[1], 10) % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    return hour * 60 + parseInt(m[2], 10);
}

/** Tonight's events at a venue, on the evening scale, earliest first. */
function timeline(venue) {
    return (venue.events || [])
        .map((e) => ({ event: e, min: toCityMinutes(parseClockToMinutes(e.eventTime)) }))
        .filter((x) => x.min !== null && (x.event.eventName || '').trim() !== '')
        .sort((a, b) => a.min - b.min);
}

/**
 * What is going on at a venue at a given city time.
 * @returns {'live'|'upcoming'|'past'|'quiet'}
 */
export function venueState(venue, cityMinutes) {
    const list = timeline(venue);
    if (!list.length) return 'quiet';
    const endOf = (i) => (i + 1 < list.length ? list[i + 1].min : list[i].min + ASSUMED_SET_MINUTES);
    for (let i = 0; i < list.length; i++) {
        if (list[i].min <= cityMinutes && cityMinutes < endOf(i)) return 'live';
    }
    if (list.some((x) => x.min > cityMinutes)) return 'upcoming';
    return 'past';
}

/**
 * The one act worth naming at a venue for a given city time, with a human label.
 * @returns {{event: Object, status: string, label: string}|null}
 */
export function pickEvent(venue, cityMinutes) {
    const list = timeline(venue);
    if (!list.length) return null;

    const endOf = (i) => (i + 1 < list.length ? list[i + 1].min : list[i].min + ASSUMED_SET_MINUTES);

    let idx = list.findIndex((x, i) => x.min <= cityMinutes && cityMinutes < endOf(i));
    let status = 'live';
    if (idx === -1) {
        idx = list.findIndex((x) => x.min > cityMinutes);
        status = idx === -1 ? 'past' : 'upcoming';
        if (idx === -1) idx = list.length - 1;
    }

    const chosen = list[idx];
    let label;
    if (status === 'live') {
        label = 'LIVE NOW';
    } else if (status === 'upcoming') {
        const mins = Math.round(chosen.min - cityMinutes);
        // "Starts in 20 min" is useful; "starts in 260 min" is not — past an hour, name the time.
        label = mins <= 60 ? `STARTS IN ${mins} MIN` : `TONIGHT · ${chosen.event.eventTime}`;
    } else {
        label = 'EARLIER TONIGHT';
    }

    return { event: chosen.event, status, label };
}

export class MarkerFactory {
    /** A venue marker. Style is applied separately so city-time changes never rebuild layers. */
    create(venue, pane) {
        const marker = L.circleMarker([venue.lat, venue.lng], {
            pane,
            className: 'venue-mark',
            interactive: true,
            bubblingMouseEvents: false,
        });
        marker.venueData = venue;
        marker.isSelected = false;
        return marker;
    }

    /**
     * Paint a marker for its state. Kept as pure style updates on an existing layer so that
     * scrubbing time animates rather than tearing markers down and rebuilding them.
     */
    applyState(marker, state) {
        marker.markerState = state;
        if (marker.isSelected) {
            // Deliberately the loudest thing on the map: a solid white core with a hard accent
            // edge. The earlier soft wash read as just another live venue.
            marker.setStyle({
                radius: 6,
                color: INK.live,
                weight: 2.6,
                opacity: 1,
                fillColor: '#ffffff',
                fillOpacity: 1,
            });
            return;
        }
        const style = {
            live: { radius: 4, color: INK.live, weight: 3.5, opacity: 0.26, fillColor: INK.live, fillOpacity: 1 },
            upcoming: { radius: 4, color: INK.upcoming, weight: 1.3, opacity: 0.9, fillColor: INK.upcoming, fillOpacity: 0 },
            past: { radius: 3, color: INK.upcoming, weight: 1, opacity: 0.45, fillColor: INK.upcoming, fillOpacity: 0 },
            quiet: { radius: 2.5, color: INK.quiet, weight: 0, opacity: 0, fillColor: INK.quiet, fillOpacity: 0.6 },
        }[state] || {};
        marker.setStyle(style);
    }

    setSelected(marker, selected) {
        marker.isSelected = !!selected;
        // Stacking is handled with bringToFront() within the events pane rather than moving the
        // path between panes — Leaflet owns that DOM and reparenting it fights redraws.
        this.applyState(marker, marker.markerState || 'quiet');
    }
}
