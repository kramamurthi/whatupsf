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
     * Create a cluster marker (blue circle representing multiple venues)
     * @param {Object} cluster - Cluster data with center and mlist
     * @param {number} radius - Cluster radius
     * @param {Function} onClick - Click handler for zooming in
     * @param {boolean} isHighlighted - Whether this is the highlighted cluster
     * @returns {Object} Leaflet circle marker
     */
    createClusterMarker(cluster, radius, onClick, isHighlighted = false) {
        const venueCount = cluster.mlist.length;

        // Use circle marker - transparent if highlighted, more opaque otherwise
        const marker = L.circle(
            [cluster.center[0], cluster.center[1]],
            radius,
            {
                color: isHighlighted ? '#00ffff' : '#00d4ff',
                weight: isHighlighted ? 4 : 3,
                fillColor: '#0066ff',
                fillOpacity: isHighlighted ? 0 : 0.35, // Completely transparent if highlighted
                zIndexOffset: 100,
                className: 'cluster-marker'
            }
        );

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
