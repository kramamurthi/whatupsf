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
        this.venueColor = '#FF0000'; // Red for all unselected venues
        this.selectedColor = '#FF00FF'; // Magenta for selected
    }

    /**
     * Create a venue marker with popup
     * @param {Object} venue - Venue data with lat, lng, venue name, url, events
     * @param {number} radius - Marker radius
     * @returns {Object} Leaflet circle marker
     */
    createVenueMarker(venue, radius) {
        const size = radius * 0.2; // Small red markers

        const marker = L.circle([venue.lat, venue.lng], size, {
            color: this.venueColor,
            weight: 1,
            fillColor: this.venueColor,
            fillOpacity: 1.0,
            zIndexOffset: 0,
            className: 'venue-marker venue-jewel-blink'
        });

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
            maxWidth: 320,
            className: 'dark-popup'
        });

        // Store venue data on marker for filtering
        marker.venueData = venue;

        return marker;
    }

    /**
     * Build HTML for event list with SoundCloud embeds
     * @param {Array} events - Array of event objects
     * @returns {string} HTML string
     */
    buildEventList(events) {
        if (!events || events.length === 0) {
            return '<p class="text-gray-400">No events scheduled</p>';
        }

        return events.map(event => {
            // Only create SoundCloud embed if eventUrl exists
            let embedHTML = '';
            if (event.eventUrl) {
                embedHTML = `
                    <div style="position:relative;width:300px;padding-top:56.25%;overflow:hidden;margin-bottom:12px;">
                        <iframe
                            src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${event.eventUrl}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true"
                            style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
                            allowfullscreen
                        ></iframe>
                    </div>
                `;
            }

            return `
                ${embedHTML}
                <h2>
                    ${event.eventName || 'Untitled Event'}
                    ${event.eventTime || ''}
                    ${event.eventPrice || ''}
                </h2>
                <hr style="border-color: rgba(255,255,255,0.2); margin: 8px 0;">
            `;
        }).join('');
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
        marker.setRadius(radius * 0.5); // Larger when selected
        marker.setStyle({
            color: this.selectedColor,
            weight: 2,
            fillColor: this.selectedColor,
            fillOpacity: 1.0
        });
        marker.bringToFront();

        // Update classes immediately (marker is already on map)
        const element = marker.getElement();
        if (element) {
            element.classList.remove('venue-jewel-blink');
            element.classList.add('venue-selected');
        }
    }

    /**
     * Reset marker to normal appearance
     * @param {Object} marker - Leaflet marker to reset
     * @param {number} radius - Normal radius
     */
    resetMarker(marker, radius) {
        const size = radius * 0.2; // Small red marker

        // Update marker style
        marker.setRadius(size);
        marker.setStyle({
            color: this.venueColor,
            weight: 1,
            fillColor: this.venueColor,
            fillOpacity: 1.0
        });

        // Update classes immediately if element exists
        const element = marker.getElement();
        if (element) {
            element.classList.remove('venue-selected');
            element.classList.add('venue-jewel-blink');
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
