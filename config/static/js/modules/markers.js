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

/**
 * MarkerFactory - Creates venue and cluster markers with modern styling
 */
export class MarkerFactory {
    constructor() {
        this.venueColorActive = '#39FF14';   // Neon green for venues with events today
        this.venueColorInactive = '#A0856C'; // Muted amber for venues with no events today
        this.selectedColor = '#FF00FF'; // Magenta for selected
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

        // Build event list HTML
        const eventListHTML = this.buildEventList(venue.events);

        // Create popup content with neon styling
        const popupContent = `
            <a href="http://${venue.url}" target="_blank" rel="noopener">
                <h1>${venue.venue}</h1>
            </a>
            ${eventListHTML}
        `;

        marker.bindPopup(popupContent, {
            maxWidth: 480,
            className: 'dark-popup'
        });

        // Prevent Leaflet from swallowing clicks/scrolls inside the popup,
        // which would block interaction with embedded iframes.
        marker.on('popupopen', function () {
            const el = this.getPopup().getElement();
            if (el) {
                L.DomEvent.disableClickPropagation(el);
                L.DomEvent.disableScrollPropagation(el);
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
