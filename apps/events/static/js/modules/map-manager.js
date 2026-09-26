/**
 * MapManager — the city window.
 *
 * The defining constraint: the user pans freely but the scale never changes. Everything the
 * user sees is at one fixed viewing scale, so the city moves underneath a stable frame rather
 * than the frame jumping around the city. Nothing here is allowed to change zoom — not
 * selection, not recentring, not the jukebox.
 */
import { MarkerFactory, venueState } from './markers.js';

// ~9.5 m/px at San Francisco's latitude, so a portrait phone frames roughly a third of the
// city across. Fractional zoom needs zoomSnap: 0; it downscales z14 tiles, which stays crisp.
const FIXED_ZOOM = 13.7;

const SF_CENTER = [37.7735, -122.4300];

// Keep exploration in San Francisco without a hard wall at the edge.
const SF_BOUNDS = L.latLngBounds([37.700, -122.530], [37.835, -122.345]);

export class MapManager {
    constructor(mapElementId, stadiaApiKey) {
        this.mapElementId = mapElementId;
        this.stadiaApiKey = stadiaApiKey;
        this.map = null;
        this.markerFactory = new MarkerFactory();
        this.markers = [];
        this.selected = null;
        this.cityMinutes = null;
        this.userMarker = null;
        this.userCircle = null;
        this.userPosition = null;
        this.onSelect = () => {};
    }

    initialize() {
        this.map = L.map(this.mapElementId, {
            center: SF_CENTER,
            zoom: FIXED_ZOOM,
            // Pinning min and max to the fixed zoom is the actual guarantee. Disabling the
            // gesture handlers alone would still leave setView, fitBounds, locate and the
            // keyboard +/- able to change scale.
            minZoom: FIXED_ZOOM,
            maxZoom: FIXED_ZOOM,
            zoomSnap: 0,
            zoomControl: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            touchZoom: false,
            boxZoom: false,
            keyboard: true,
            maxBounds: SF_BOUNDS,
            maxBoundsViscosity: 0.6,
            attributionControl: true,
        });

        // Layer order, declared up front so a future atmospheric layer can be inserted without
        // touching event rendering: basemap < fog < events < selection < interface.
        this.map.createPane('fogPane').style.zIndex = 350;      // reserved, empty for now
        this.map.getPane('fogPane').style.pointerEvents = 'none';
        this.map.createPane('eventsPane').style.zIndex = 400;
        this.map.createPane('selectPane').style.zIndex = 450;

        L.tileLayer(
            `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${this.stadiaApiKey}`,
            {
                maxZoom: 20,
                detectRetina: true,
                attribution:
                    '© <a href="https://www.stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> ' +
                    '© <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
                    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
            }
        ).addTo(this.map);

        // Tapping empty map clears the selection rather than leaving a stale highlight.
        this.map.on('click', () => this.clearSelection());

        return this.map;
    }

    // --- venues -----------------------------------------------------------------

    loadVenueData(venues) {
        this.venues = venues || [];
        this.markers = this.venues
            .filter((v) => v.lat != null && v.lng != null)
            .map((venue) => {
                const marker = this.markerFactory.create(venue, 'eventsPane');
                marker.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    this.selectMarker(marker);
                });
                marker.addTo(this.map);
                return marker;
            });
        if (this.cityMinutes !== null) this.setCityTime(this.cityMinutes);
    }

    /** Restyle every marker for a city time. Never touches the viewport. */
    setCityTime(cityMinutes) {
        this.cityMinutes = cityMinutes;
        for (const marker of this.markers) {
            this.markerFactory.applyState(marker, venueState(marker.venueData, cityMinutes));
        }
    }

    markerForVenue(venueName) {
        return this.markers.find((m) => m.venueData.venue === venueName) || null;
    }

    // --- selection --------------------------------------------------------------

    /**
     * @param {Object} opts.pan     nudge the marker into view if it is off-screen
     * @param {Object} opts.silent  skip the onSelect callback. Used when the jukebox drove the
     *   selection: it has already rendered richer context, and letting the callback run would
     *   overwrite it with a plainer version of the same thing.
     */
    selectMarker(marker, { pan = true, silent = false } = {}) {
        if (!marker) return;
        if (this.selected && this.selected !== marker) {
            this.markerFactory.setSelected(this.selected, false);
        }
        this.selected = marker;
        this.markerFactory.setSelected(marker, true);
        marker.bringToFront();
        this.drawSelectionHalo(marker.getLatLng());
        if (pan) this.panIntoView(marker.getLatLng());
        if (!silent) this.onSelect(marker.venueData);
    }

    /**
     * A ring around the selected venue, in its own pane above every other marker.
     * Restyling the dot alone was not enough to find at a glance on a busy map — the ring
     * gives the selection a footprint. Unfilled, so the dot inside stays legible.
     */
    drawSelectionHalo(latlng) {
        if (!this.selectionHalo) {
            this.selectionHalo = L.circleMarker(latlng, {
                pane: 'selectPane',
                className: 'sel-halo',
                radius: 14,
                color: '#ff7a45',
                weight: 1.6,
                opacity: 0.95,
                fillColor: '#ff7a45',
                fillOpacity: 0.07,
                interactive: false,
            }).addTo(this.map);
        } else {
            this.selectionHalo.setLatLng(latlng);
            if (!this.map.hasLayer(this.selectionHalo)) this.selectionHalo.addTo(this.map);
        }
        // Restart the entry animation on each new selection.
        const el = this.selectionHalo._path;
        if (el) {
            el.classList.remove('sel-halo--in');
            void el.getBoundingClientRect();
            el.classList.add('sel-halo--in');
        }
    }

    selectVenue(venueName, opts) {
        const marker = this.markerForVenue(venueName);
        if (marker) this.selectMarker(marker, opts);
        return marker;
    }

    clearSelection() {
        if (!this.selected) return;
        this.markerFactory.setSelected(this.selected, false);
        this.selected = null;
        if (this.selectionHalo && this.map.hasLayer(this.selectionHalo)) {
            this.map.removeLayer(this.selectionHalo);
        }
    }

    // --- viewport ---------------------------------------------------------------

    /**
     * Nudge a point into view only if it is outside the comfortable rect, and only by as much
     * as needed. Recentring on every selection would make the map feel like it was yanking
     * itself around; this leaves the composition alone when the venue is already visible.
     */
    panIntoView(latlng, padding = { top: 40, right: 76, bottom: 40, left: 28 }) {
        const pt = this.map.latLngToContainerPoint(latlng);
        const size = this.map.getSize();
        const right = size.x - padding.right;
        const bottom = size.y - padding.bottom;

        let dx = 0;
        let dy = 0;
        if (pt.x < padding.left) dx = pt.x - padding.left;
        else if (pt.x > right) dx = pt.x - right;
        if (pt.y < padding.top) dy = pt.y - padding.top;
        else if (pt.y > bottom) dy = pt.y - bottom;

        if (dx || dy) this.map.panBy([dx, dy], { animate: true, duration: 0.55 });
    }

    /** Recentre on the user. Pan only — the scale is not ours to change. */
    recenterOnUser() {
        if (this.userPosition) {
            this.map.panTo(this.userPosition, { animate: true, duration: 0.6 });
            return true;
        }
        return false;
    }

    /** Show where the user is, and remember it for recentring and distance ranking. */
    setUserPosition(lat, lng, accuracy) {
        const latlng = L.latLng(lat, lng);
        this.userPosition = latlng;

        if (!this.userMarker) {
            this.userMarker = L.marker(latlng, {
                icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
                interactive: false,
                keyboard: false,
            }).addTo(this.map);
        } else {
            this.userMarker.setLatLng(latlng);
        }

        if (this.userCircle) this.map.removeLayer(this.userCircle);
        this.userCircle = L.circle(latlng, {
            pane: 'eventsPane',
            radius: Math.min(accuracy || 60, 400),
            color: '#ff5a4d',
            weight: 1,
            opacity: 0.35,
            fillColor: '#ff5a4d',
            fillOpacity: 0.07,
            interactive: false,
        }).addTo(this.map);
    }
}
