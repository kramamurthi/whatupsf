import { nowMinutesSF } from './time-slider.js';

/**
 * Calculate convex hull of points using Graham scan algorithm
 * @param {Array} points - Array of [lat, lng] coordinates
 * @returns {Array} Points forming the convex hull
 */
function calculateConvexHull(points) {
    if (points.length < 3) return points;

    // Find the point with lowest y-coordinate (southernmost)
    let pivot = points[0];
    for (let i = 1; i < points.length; i++) {
        if (points[i][0] < pivot[0] || (points[i][0] === pivot[0] && points[i][1] < pivot[1])) {
            pivot = points[i];
        }
    }

    // Sort points by polar angle with respect to pivot
    const sorted = points.slice().sort((a, b) => {
        if (a === pivot) return -1;
        if (b === pivot) return 1;

        const angleA = Math.atan2(a[0] - pivot[0], a[1] - pivot[1]);
        const angleB = Math.atan2(b[0] - pivot[0], b[1] - pivot[1]);

        if (angleA < angleB) return -1;
        if (angleA > angleB) return 1;

        // If angles are equal, closer point comes first
        const distA = Math.pow(a[0] - pivot[0], 2) + Math.pow(a[1] - pivot[1], 2);
        const distB = Math.pow(b[0] - pivot[0], 2) + Math.pow(b[1] - pivot[1], 2);
        return distA - distB;
    });

    // Build convex hull
    const hull = [sorted[0], sorted[1]];

    for (let i = 2; i < sorted.length; i++) {
        while (hull.length > 1 && !isLeftTurn(hull[hull.length - 2], hull[hull.length - 1], sorted[i])) {
            hull.pop();
        }
        hull.push(sorted[i]);
    }

    return hull;
}

function isLeftTurn(p1, p2, p3) {
    return ((p2[1] - p1[1]) * (p3[0] - p2[0]) - (p2[0] - p1[0]) * (p3[1] - p2[1])) > 0;
}

// How long the final act of the day is assumed to run, since nothing follows it to
// mark its end. Only affects whether the closer still reads as "on now".
const ASSUMED_SET_MINUTES = 75;

/** Parse publish.json's "12:35 PM" into minutes since midnight, or null. */
export function parseClockToMinutes(text) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(text || '');
    if (!m) return null;
    const hour = (parseInt(m[1], 10) % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    return hour * 60 + parseInt(m[2], 10);
}

/**
 * MarkerFactory - Creates venue and cluster markers with modern styling
 */
export class MarkerFactory {
    constructor() {
        this.venueColorActive = '#39FF14';   // Neon green for venues with events today
        this.venueColorInactive = '#A0856C'; // Muted amber for venues with no events today
        this.selectedColor = '#FF00FF'; // Magenta for selected

        // Show one act per venue instead of the whole lineup. Set during OSL, where a
        // stage's full day is unreadable on a phone.
        this.singleShowMode = !!window.MAP_CONFIG?.oslActive;
        // {minutes} is what the slider points at, {realNow} the actual clock, {custom}
        // whether the user has scrubbed away from now. Labelling needs all three.
        // Overridden by MapManager once the time slider exists.
        this.getTimeContext = () => {
            const now = nowMinutesSF();
            return { minutes: now, realNow: now, custom: false };
        };
    }

    hasEvents(venue) {
        return venue.events && venue.events.length > 0 && venue.events[0].eventName !== '';
    }

    createVenueMarker(venue, radius) {
        const active = this.hasEvents(venue);
        const color = active ? this.venueColorActive : this.venueColorInactive;
        const size = radius * 0.4;

        const marker = L.circle([venue.lat, venue.lng], size, {
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: 1.0,
            zIndexOffset: 0,
            className: 'venue-marker'
        });
        marker._venueColor = color; // store for reset
        marker._isActive = active;  // store for sizing

        // In single-show mode the readout lives in the fixed StagePanel above the park, not
        // in a popup hanging off this marker, so nothing is bound here at all.
        if (this.singleShowMode) {
            marker.venueData = venue;
            return marker;
        }

        // Build event list HTML
        const popupContent = `
            <a href="http://${venue.url}" target="_blank" rel="noopener">
                <h1>${venue.venue}</h1>
            </a>
            ${this.buildEventList(venue.events)}
        `;

        // A full lineup is taller and wider than a phone screen, so cap both and let the
        // body scroll. 480 alone overflows a 390px viewport once Leaflet adds its wrapper
        // padding, hence the CSS guard on .leaflet-popup-content-wrapper as well.
        marker.bindPopup(popupContent, {
            maxWidth: Math.min(480, Math.max(240, window.innerWidth - 48)),
            maxHeight: Math.max(240, Math.round(window.innerHeight * 0.6)),
            className: 'dark-popup'
        });

        // Prevent Leaflet from swallowing clicks/scrolls inside the popup,
        // which would block interaction with embedded iframes.
        marker.on('popupopen', function () {
            const el = this.getPopup().getElement();
            if (!el) return;
            L.DomEvent.disableClickPropagation(el);
            L.DomEvent.disableScrollPropagation(el);

            // Leaflet hangs the popup above its marker. A cap based on window height
            // cannot know how much room that leaves, and when the view is fenced autoPan
            // cannot create any, so a tall lineup slides up under the site header. Clamp
            // the scroll area to the space that actually exists above this marker.
            const scroller = el.querySelector('.leaflet-popup-scrolled');
            if (scroller) {
                const y = this._map.latLngToContainerPoint(this.getLatLng()).y;
                scroller.style.maxHeight = Math.max(160, y - 48) + 'px';
            }
        });

        // Store venue data on marker for filtering
        marker.venueData = venue;

        return marker;
    }

    /**
     * Return an embedded player iframe for a YouTube or SoundCloud URL.
     * size: 'small' uses a thumbnail (YouTube too narrow to play inline),
     *       'normal' / 'large' use a full iframe.
     */
    buildMediaEmbed(url, size = 'normal') {
        if (!url) return '';

        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
        if (ytMatch) {
            const videoId = ytMatch[1];
            const height = size === 'large' ? 170 : size === 'small' ? 120 : 150;
            return `<iframe
                src="https://www.youtube.com/embed/${videoId}?rel=0&start=60"
                width="100%" height="${height}"
                frameborder="0"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
                style="border-radius:4px;margin-top:4px;display:block;">
            </iframe>`;
        }

        if (url.includes('soundcloud.com')) {
            const height = size === 'small' ? 60 : 80;
            return `<iframe
                src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%2339FF14&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false"
                width="100%" height="${height}"
                frameborder="0" allow="autoplay"
                style="border-radius:4px;margin-top:4px;display:block;">
            </iframe>`;
        }

        return '';
    }

    /** One event card: name + time + price + embed */
    buildEventCard(event, size = 'normal') {
        const fontSize = size === 'small' ? '0.8rem' : '1rem';
        return `
            <h2 style="font-size:${fontSize};margin:4px 0 0;">
                ${event.eventName || 'Untitled'}
                ${event.eventTime ? `· ${event.eventTime}` : ''}
                ${event.eventPrice || ''}
            </h2>
            ${this.buildMediaEmbed(event.eventUrl, size)}
        `;
    }

    /**
     * Build HTML for event list with embedded media players.
     * 3-band nights: 2 openers side-by-side (small) on top, headliner full-width (large) on bottom.
     * All other counts: vertical stack.
     */
    /**
     * Pick the single act to show for a venue at a given moment.
     * Returns {event, status} where status is 'now' or 'next', or {event: null,
     * status: 'done', last} once the day's programme has finished.
     */
    pickShow(events, ctx) {
        const { minutes, realNow, custom } = ctx;

        const list = (events || [])
            .map((e) => ({ e, min: parseClockToMinutes(e.eventTime) }))
            .filter((x) => x.min !== null)
            .sort((a, b) => a.min - b.min);

        if (!list.length) return null;

        // An act owns the slot from its start until the next one begins. The closer has no
        // successor, so it gets a nominal set length.
        const endOf = (i) => (i + 1 < list.length ? list[i + 1].min : list[i].min + ASSUMED_SET_MINUTES);

        // Which act the *slider* is pointing at: the one whose window contains it, else
        // the next one to start, else — scrubbed past the close — the day's finale.
        let idx = list.findIndex((x, i) => x.min <= minutes && minutes < endOf(i));
        if (idx === -1) idx = list.findIndex((x) => x.min > minutes);
        if (idx === -1) idx = list.length - 1;

        // The status compares that act to the *real* clock, not the slider: scrubbing to
        // 9pm should not claim a set is on now when it is still the afternoon.
        const chosen = list[idx];
        const endsAt = endOf(idx);

        let status;
        if (!custom && chosen.min <= realNow && realNow < endsAt) status = 'now';
        else if (endsAt <= realNow) status = 'completed';
        else status = 'upcoming';

        // Position in the day is independent of status — the closer can be upcoming or
        // completed and is the closer either way — so it rides along as its own flag.
        return {
            event: chosen.e,
            status,
            isFirst: idx === 0,
            isLast: idx === list.length - 1,
        };
    }

    /**
     * Popup body showing exactly one act — a full lineup is too much to read on a phone.
     */
    buildSingleEvent(events, ctx, size = 'small') {
        const pick = this.pickShow(events, ctx);
        if (!pick) return '<p style="color:#808080">No events here today</p>';

        const LABELS = { now: 'ON NOW', completed: 'COMPLETED', upcoming: 'UPCOMING' };

        const tags = [`<span class="show-tag show-tag--${pick.status}">${LABELS[pick.status]}</span>`];
        if (pick.isFirst) tags.push('<span class="show-tag show-tag--edge">FIRST EVENT</span>');
        if (pick.isLast) tags.push('<span class="show-tag show-tag--edge">LAST EVENT</span>');

        return `<div class="single-show">${tags.join('')}${this.buildEventCard(pick.event, size)}</div>`;
    }

    buildEventList(events) {
        if (!events || events.length === 0 || events[0].eventName === '') {
            return '<p style="color:#808080">No Events Today</p>';
        }

        const hr = `<hr style="border-color:rgba(255,255,255,0.2);margin:8px 0;">`;

        if (events.length === 3) {
            const [o1, o2, headliner] = events;
            return `
                <div style="display:flex;gap:6px;align-items:flex-start;">
                    <div style="flex:1;min-width:0;">${this.buildEventCard(o1, 'small')}</div>
                    <div style="flex:1;min-width:0;">${this.buildEventCard(o2, 'small')}</div>
                </div>
                ${this.buildEventCard(headliner, 'large')}
                ${hr}
            `;
        }

        return events.map(event => `
            ${this.buildEventCard(event)}
            ${hr}
        `).join('');
    }

    /**
     * Create a cluster marker (blue circle or convex hull representing multiple venues)
     * @param {Object} cluster - Cluster data with center and mlist
     * @param {number} radius - Cluster radius
     * @param {Function} onClick - Click handler for zooming in
     * @param {boolean} isHighlighted - Whether this is the highlighted cluster
     * @param {boolean} useConvexHull - Whether to use convex hull instead of circle
     * @returns {Object} Leaflet circle or polygon marker
     */
    createClusterMarker(cluster, radius, onClick, isHighlighted = false, useConvexHull = false) {
        const venueCount = cluster.mlist.length;

        let marker;

        if (useConvexHull && cluster.mlist.length >= 3) {
            // Get all venue positions
            const points = cluster.mlist.map(m => [m.getLatLng().lat, m.getLatLng().lng]);

            // Calculate convex hull
            const hull = calculateConvexHull(points);

            // Create polygon marker
            marker = L.polygon(hull, {
                color: isHighlighted ? '#00ffff' : '#00d4ff',
                weight: isHighlighted ? 4 : 3,
                fillColor: '#0066ff',
                fillOpacity: isHighlighted ? 0 : 0.35,
                className: 'cluster-marker'
            });
        } else {
            // Use circle marker - transparent if highlighted, more opaque otherwise
            marker = L.circle(
                [cluster.center[0], cluster.center[1]],
                radius,
                {
                    color: isHighlighted ? '#00ffff' : '#00d4ff',
                    weight: isHighlighted ? 4 : 3,
                    fillColor: '#0066ff',
                    fillOpacity: isHighlighted ? 0 : 0.35,
                    zIndexOffset: 100,
                    className: 'cluster-marker'
                }
            );
        }

        // Add custom div icon with number overlay
        const numberMarker = L.marker(
            [cluster.center[0], cluster.center[1]],
            {
                icon: L.divIcon({
                    html: `<div class="cluster-number">${venueCount}</div>`,
                    className: 'cluster-icon',
                    iconSize: [40, 40]
                }),
                zIndexOffset: 1000
            }
        );

        // Add click handler to zoom in
        if (onClick) {
            marker.on('click', onClick);
            numberMarker.on('click', onClick);
        }

        // Store cluster data and associated number marker
        marker.isCluster = true;
        marker.clusterData = cluster;
        marker.numberMarker = numberMarker;

        return marker;
    }

    /**
     * Highlight a selected marker with neon glow effect
     * @param {Object} marker - Leaflet marker to highlight
     * @param {number} radius - New radius (larger than normal)
     */
    highlightMarker(marker, radius) {
        marker.setRadius(radius * 0.5);
        marker.setStyle({
            color: this.selectedColor,
            weight: 2,
            fillColor: this.selectedColor,
            fillOpacity: 1.0
        });
        marker.bringToFront();

        const element = marker.getElement();
        if (element) {
            element.classList.add('venue-selected');
        }
    }

    /**
     * Reset marker to normal appearance
     * @param {Object} marker - Leaflet marker to reset
     * @param {number} radius - Normal radius
     */
    resetMarker(marker, radius) {
        const size = marker._isActive ? radius * 0.6 : radius * 0.4;
        const color = marker._venueColor || this.venueColorInactive;

        marker.setRadius(size);
        marker.setStyle({
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: 1.0
        });

        const element = marker.getElement();
        if (element) {
            element.classList.remove('venue-selected');
        }
    }

    /**
     * Reset cluster marker to normal appearance
     * @param {Object} marker - Leaflet cluster marker to reset
     * @param {number} radius - Normal radius
     */
    resetClusterMarker(marker, radius) {
        marker.setRadius(radius);
        marker.setStyle({
            color: '#FFF',
            weight: 0,
            fillColor: '#00F',
            fillOpacity: 0.5
        });
    }
}
