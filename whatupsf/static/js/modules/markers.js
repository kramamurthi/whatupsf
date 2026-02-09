/**
 * MarkerFactory - Creates venue and cluster markers with modern styling
 */
export class MarkerFactory {
    constructor() {
        this.markerColor = '#f00'; // Default red color
    }

    /**
     * Create a venue marker with popup
     * @param {Object} venue - Venue data with lat, lng, venue name, url, events
     * @param {number} radius - Marker radius
     * @returns {Object} Leaflet circle marker
     */
    createVenueMarker(venue, radius) {
        const marker = L.circle([venue.lat, venue.lng], radius, {
            color: '#FFF',
            weight: 0,
            fillColor: this.markerColor,
            fillOpacity: 0.8,
            zIndexOffset: 0
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
     * @returns {Object} Leaflet circle marker
     */
    createClusterMarker(cluster, radius, onClick) {
        const venueCount = cluster.mlist.length;

        // Use circle marker for better control
        const marker = L.circle(
            [cluster.center[0], cluster.center[1]],
            radius,
            {
                color: '#00f0ff',
                weight: 2,
                fillColor: '#0066ff', // Neon blue for clusters
                fillOpacity: 0.6,
                zIndexOffset: 0,
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
        marker.setRadius(radius * 1.33);
        marker.setStyle({
            color: '#F00',
            weight: 2,
            fillColor: '#ffff4d',
            fillOpacity: 0.9
        });
        marker.bringToFront();
    }

    /**
     * Reset marker to normal appearance
     * @param {Object} marker - Leaflet marker to reset
     * @param {number} radius - Normal radius
     */
    resetMarker(marker, radius) {
        marker.setRadius(radius);
        marker.setStyle({
            color: '#FFF',
            weight: 0,
            fillColor: this.markerColor,
            fillOpacity: 0.8
        });
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
