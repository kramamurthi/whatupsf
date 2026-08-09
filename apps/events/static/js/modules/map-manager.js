/**
 * MapManager - Handles Leaflet map initialization and marker management
 */
import { ClusteringEngine } from './clustering.js';
import { MarkerFactory } from './markers.js';
import { TimeSlider, nowMinutesSF } from './time-slider.js';
import { StagePanel } from './stage-panel.js';

// Golden Gate Park: Fulton to Lincoln, Stanyan to the Great Highway. Used both as the
// hole in the Outside Lands dim mask and as the fence the locked view cannot leave.
const PARK_SW = [37.7645, -122.5110];
const PARK_NE = [37.7740, -122.4530];


export class MapManager {
    constructor(mapElementId, stadiaApiKey, useConvexHull = false) {
        this.mapElementId = mapElementId;
        this.stadiaApiKey = stadiaApiKey;
        this.useConvexHull = useConvexHull;
        this.map = null;
        this.clusteringEngine = new ClusteringEngine();
        this.markerFactory = new MarkerFactory();

        // Config
        this.blinkEnabled = false; // Set true to re-enable blink animation

        // State
        this.rawMarkers = [];
        this.displayedMarkers = [];
        this.currentSelectedMarkerId = -1;
        this.rawVenueData = [];
        this.clusterGroups = []; // Store cluster info for liquid glass effect
        this.blinkInterval = null; // Interval for blinking effect
        this.unusedMarkers = []; // For random without replacement
    }

    /**
     * Initialize the Leaflet map with dark tiles
     */
    initialize() {
        // Create dark tile layer (Stadia Toner - dark theme)
        const darkTiles = L.tileLayer(
            `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${this.stadiaApiKey}`,
            {
                maxZoom: 20,
                attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
        );

        // Outside Lands 2026 — lock the map onto Golden Gate Park for the run of the
        // festival. The window is decided server-side (map_view.osl_active) so the date
        // lives in exactly one place; see window.MAP_CONFIG in whatupsf/index.html.
        const isOSL = !!window.MAP_CONFIG?.oslActive;
        this.isOSL = isOSL;
        const OSL_CENTER = [37.7698, -122.4890];
        const OSL_ZOOM = 16;
        // Bounding box of the 8 stages, used to guarantee none of them lands off-screen.
        const OSL_BOUNDS = L.latLngBounds([[37.76759, -122.49495], [37.77193, -122.48307]]);

        // Initialize map with dark tiles. During the festival the view is fixed: no
        // dragging, no zooming, no keyboard nav — it is a poster of the park, not a
        // browsable map.
        this.map = L.map(this.mapElementId, {
            center: isOSL ? OSL_CENTER : [37.7749, -122.4494], // San Francisco center (shifted west)
            zoom: isOSL ? OSL_ZOOM : 14,
            minZoom: 11,
            maxZoom: 17,
            zoomControl: false,
            dragging: !isOSL,
            touchZoom: !isOSL,
            doubleClickZoom: !isOSL,
            boxZoom: !isOSL,
            keyboard: !isOSL,
            layers: [darkTiles]
        });

        // Disable scroll wheel zoom (use pinch on mobile)
        this.map.scrollWheelZoom.disable();

        if (isOSL) {
            // Zoom 16 frames the park nicely on a laptop but crops the stage footprint on
            // a phone — and with panning off, a cropped stage is simply unreachable. Back
            // off only as far as needed to fit all 8, then freeze the zoom there.
            const fitZoom = Math.min(OSL_ZOOM, this.map.getBoundsZoom(OSL_BOUNDS, false, L.point(28, 28)));
            this.map.setView(OSL_CENTER, fitZoom, { animate: false });
            this.map.setMinZoom(fitZoom);
            this.map.setMaxZoom(fitZoom);

            // Fence the map to the park. Dragging is already off, so the only thing that
            // can still move the view is a popup's autoPan — which we want, because a
            // popup anchored near a phone's screen edge is unreadable otherwise. This
            // bounds that nudge: it can reposition within the park, never wander off it.
            this.map.setMaxBounds(L.latLngBounds(PARK_SW, PARK_NE));
            this.map.options.maxBoundsViscosity = 1.0;

            // Mute everything outside the park so the festival footprint reads first.
            this.addParkSpotlight();
        } else {
            // Add zoom control to bottom-left
            L.control.zoom({ position: 'bottomleft' }).addTo(this.map);
        }

        // Add locate-me control
        this.addLocateMeControl();

        // Setup event listeners
        this.setupEventListeners();

        // Log tile layer events for debugging
        darkTiles.on('loading', () => {
            console.log('🗺️ Loading dark map tiles...');
        });

        darkTiles.on('load', () => {
            console.log('✅ Dark map tiles loaded successfully');
        });

        darkTiles.on('tileerror', (error) => {
            console.error('❌ Error loading map tile:', error);
        });

        console.log('✅ Leaflet map initialized with dark tiles');
        return this.map;
    }

    /**
     * Dim everything outside Golden Gate Park.
     *
     * One polygon whose outer ring is the whole world and whose inner ring is the park;
     * Leaflet treats the second ring as a hole, so the fill covers everything except the
     * park. Sits in its own pane above the overlay pane, which means venue circles outside
     * the park get muted along with the tiles, while popups and the user-location marker
     * (higher panes) stay crisp. pointer-events:none keeps clicks reaching the markers.
     */
    addParkSpotlight() {
        const WORLD = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
        const PARK = [
            [PARK_NE[0], PARK_SW[1]],
            [PARK_NE[0], PARK_NE[1]],
            [PARK_SW[0], PARK_NE[1]],
            [PARK_SW[0], PARK_SW[1]]
        ];

        this.map.createPane('oslDim');
        const pane = this.map.getPane('oslDim');
        pane.style.zIndex = 450;          // tiles 200 < overlay 400 < here < marker 600
        pane.style.pointerEvents = 'none';

        L.polygon([WORLD, PARK], {
            pane: 'oslDim',
            stroke: false,
            fillColor: '#05060a',
            fillOpacity: 0.7,
            interactive: false
        }).addTo(this.map);
    }

    /**
     * Add custom locate-me control
     */
    addLocateMeControl() {
        let userMarker = null;
        let userCircle = null;

        const userIcon = L.divIcon({
            className: '',
            html: `<div class="user-location-dot"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });

        const updateUserPos = (latlng, accuracy) => {
            if (!userMarker) {
                userMarker = L.marker(latlng, { icon: userIcon, title: "You are here" }).addTo(this.map);
            } else {
                userMarker.setLatLng(latlng);
            }

            // Remove and recreate circle to avoid animation glitches on zoom
            if (userCircle) {
                this.map.removeLayer(userCircle);
            }
            userCircle = L.circle(latlng, {
                radius: accuracy || 25,
                color: '#FF2D2D',
                fillColor: '#FF2D2D',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(this.map);
        };

        // Custom control
        L.Control.LocateMe = L.Control.extend({
            options: { position: "bottomleft" },
            onAdd: (map) => {
                const container = L.DomUtil.create("div", "leaflet-bar");
                const btn = L.DomUtil.create("a", "locate-btn", container);
                btn.href = "#";
                btn.title = "Find my location";
                // Sizing and colour live in CSS (.locate-btn) so the control can be
                // restyled without touching the SVG markup.
                btn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <line x1="12" y1="2" x2="12" y2="6"/>
                    <line x1="12" y1="18" x2="12" y2="22"/>
                    <line x1="2" y1="12" x2="6" y2="12"/>
                    <line x1="18" y1="12" x2="22" y2="12"/>
                </svg>`;

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(btn, "click", (e) => {
                    e.preventDefault();

                    if (!("geolocation" in navigator)) {
                        alert("Geolocation not supported on this device/browser.");
                        return;
                    }

                    map.locate({
                        // During OSL the view is pinned to the park; recentring on the
                        // user would strand them, since dragging is off and there would
                        // be no way back. Drop the marker, leave the framing alone.
                        setView: !this.isOSL,
                        maxZoom: 14,
                        watch: false,
                        enableHighAccuracy: true,
                        timeout: 8000,
                        maximumAge: 0
                    });
                });

                return container;
            },
            onRemove: () => {}
        });

        // Handle location events
        this.map.on("locationfound", (e) => {
            updateUserPos(e.latlng, e.accuracy);
        });

        this.map.on("locationerror", (e) => {
            console.warn("Location error:", e.message);
            alert("Couldn't get your location. Please allow location access and try again.");
        });

        // Add control to map
        L.control.locateMe = (opts) => new L.Control.LocateMe(opts);
        L.control.locateMe({ position: "bottomleft" }).addTo(this.map);
    }

    /**
     * Setup map event listeners
     */
    setupEventListeners() {
        // Handle zoom changes
        this.map.on('zoomend', () => this.handleZoomChange());

        // Handle map clicks for marker selection
        this.map.on('click', (e) => this.handleMapClick(e));

        // Handle map pan/move for liquid glass effect
        this.map.on('moveend', () => this.updateHighlightedCluster());
    }

    /**
     * Handle zoom level changes (switch between clustered and individual markers)
     */
    handleZoomChange() {
        const zoom = this.map.getZoom();

        // Clear selection - markers will be redrawn with correct colors
        this.currentSelectedMarkerId = -1;

        // Remove all displayed markers (including number markers for clusters)
        this.displayedMarkers.forEach(marker => {
            this.map.removeLayer(marker);
            // Remove associated number marker if it's a cluster
            if (marker.numberMarker) {
                this.map.removeLayer(marker.numberMarker);
            }
        });
        this.displayedMarkers = [];
        this.clusterGroups = [];

        // Clear blink interval
        if (this.blinkInterval) {
            clearInterval(this.blinkInterval);
            this.blinkInterval = null;
        }


        if (zoom > 16) {
            // Show individual markers at high zoom
            this.showIndividualMarkers();
        } else {
            // Show clustered markers at lower zoom
            this.showClusteredMarkers();
        }
    }

    /**
     * Show individual venue markers (zoom > 16)
     */
    showIndividualMarkers() {
        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());

        this.rawMarkers.forEach(marker => {
            const color = marker._venueColor || this.markerFactory.venueColorInactive;
            const r = marker._isActive ? radius * 0.6 : radius * 0.4;
            marker.setRadius(r);
            marker.setStyle({ color, weight: 1, fillColor: color, fillOpacity: 1.0 });
            marker.addTo(this.map);

            const element = marker.getElement();
            if (element) {
                element.classList.remove('venue-selected', 'venue-jewel-blink');
                if (this.blinkEnabled) element.classList.add('venue-jewel-blink');
            }
        });

        this.displayedMarkers = [...this.rawMarkers];
    }

    /**
     * Show clustered markers (zoom <= 16)
     */
    showClusteredMarkers() {
        const zoom = this.map.getZoom();
        const clusterSize = this.clusteringEngine.getClusterSize(zoom);
        const radius = this.clusteringEngine.getZoomRadius(zoom);

        // Only cluster active venues; inactive ones always show individually
        const activeMarkers = this.rawMarkers.filter(m => m._isActive);
        const inactiveMarkers = this.rawMarkers.filter(m => !m._isActive);

        // Add inactive markers individually (no clustering)
        inactiveMarkers.forEach(marker => {
            const color = marker._venueColor || this.markerFactory.venueColorInactive;
            marker.setRadius(radius * 0.4);
            marker.setStyle({ color, weight: 1, fillColor: color, fillOpacity: 1.0 });
            marker.addTo(this.map);
            this.displayedMarkers.push(marker);
        });

        const clusters = this.clusteringEngine.cluster(activeMarkers, clusterSize);

        // Find cluster closest to screen center
        const mapCenter = this.map.getCenter();
        let closestCluster = null;
        let minDistance = Infinity;

        clusters.forEach(cluster => {
            if (cluster.mlist.length >= 5) {
                const clusterLatLng = L.latLng(cluster.center[0], cluster.center[1]);
                const distance = mapCenter.distanceTo(clusterLatLng);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestCluster = cluster;
                }
            }
        });

        // Create markers for each cluster
        clusters.forEach(cluster => {
            if (cluster.mlist.length >= 5) {
                // Check if this is the closest cluster to center
                const isClosest = (cluster === closestCluster);

                // Multiple venues - show individual markers WITH cluster circle over them

                // Add all individual venue markers
                cluster.mlist.forEach(venueMarker => {
                    const color = venueMarker._venueColor || this.markerFactory.venueColorInactive;
                    const r = venueMarker._isActive ? radius * 0.6 : radius * 0.4;
                    venueMarker.setRadius(r);
                    venueMarker.setStyle({ color, weight: 1, fillColor: color, fillOpacity: 1.0 });
                    venueMarker.addTo(this.map);
                    this.displayedMarkers.push(venueMarker);

                    const element = venueMarker.getElement();
                    if (element) {
                        element.classList.remove('venue-selected', 'venue-jewel-blink');
                        if (this.blinkEnabled && isClosest) element.classList.add('venue-jewel-blink');
                    }
                });

                // Then add cluster circle/hull over them (opaque if closest)
                const clusterRadius = this.clusteringEngine.calculateClusterRadius(cluster, radius);
                const clusterMarker = this.markerFactory.createClusterMarker(
                    cluster,
                    clusterRadius,
                    (e) => this.handleClusterClick(e),
                    isClosest,
                    this.useConvexHull
                );
                clusterMarker.addTo(this.map);

                // Add number marker on top
                if (clusterMarker.numberMarker) {
                    clusterMarker.numberMarker.addTo(this.map);
                }

                this.displayedMarkers.push(clusterMarker);

                // Store cluster group for liquid glass effect
                this.clusterGroups.push({
                    cluster: cluster,
                    clusterMarker: clusterMarker,
                    venueMarkers: cluster.mlist,
                    isHighlighted: isClosest
                });
            } else {
                // Small cluster (1-4 venues) — show all individually, no cluster circle
                cluster.mlist.forEach(marker => {
                    const color = marker._venueColor || this.markerFactory.venueColorInactive;
                    const r = marker._isActive ? radius * 0.6 : radius * 0.4;
                    marker.setRadius(r);
                    marker.setStyle({ color, weight: 1, fillColor: color, fillOpacity: 1.0 });
                    marker.addTo(this.map);
                    this.displayedMarkers.push(marker);

                    const element = marker.getElement();
                    if (element) {
                        element.classList.remove('venue-selected', 'venue-jewel-blink');
                        if (this.blinkEnabled) element.classList.add('venue-jewel-blink');
                    }
                });
            }
        });

        // Start blinking effect for highlighted cluster
        this.startBlinking();
    }

    /**
     * Start blinking effect for markers (one at a time, random without replacement)
     */
    startBlinking() {
        if (this.blinkInterval) {
            clearInterval(this.blinkInterval);
            this.blinkInterval = null;
        }
        if (!this.blinkEnabled) return;

        let currentBlinkingMarker = null;

        this.blinkInterval = setInterval(() => {
            // Reset previous blinking marker
            if (currentBlinkingMarker) {
                currentBlinkingMarker.setStyle({ fillOpacity: 1.0, opacity: 1.0 });
            }

            // Find highlighted group
            const highlightedGroup = this.clusterGroups.find(g => g.isHighlighted);
            if (highlightedGroup && highlightedGroup.venueMarkers.length > 0) {
                if (this.unusedMarkers.length === 0) {
                    this.unusedMarkers = [...highlightedGroup.venueMarkers];
                }

                const randomIndex = Math.floor(Math.random() * this.unusedMarkers.length);
                currentBlinkingMarker = this.unusedMarkers.splice(randomIndex, 1)[0];

                currentBlinkingMarker.setStyle({ fillOpacity: 0.2, opacity: 0.2 });
            }
        }, 200); // Switch to new marker every 200ms
    }

    /**
     * Update highlighted cluster based on current map center (liquid glass effect)
     */
    updateHighlightedCluster() {
        if (this.clusterGroups.length === 0) return;

        const mapCenter = this.map.getCenter();
        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());

        // Find closest cluster to center
        let closestGroup = null;
        let minDistance = Infinity;

        this.clusterGroups.forEach(group => {
            const clusterLatLng = L.latLng(group.cluster.center[0], group.cluster.center[1]);
            const distance = mapCenter.distanceTo(clusterLatLng);
            if (distance < minDistance) {
                minDistance = distance;
                closestGroup = group;
            }
        });

        // Update all cluster groups
        this.clusterGroups.forEach(group => {
            const isNowHighlighted = (group === closestGroup);

            // Update cluster circle style
            group.clusterMarker.setStyle({
                color: isNowHighlighted ? '#00ffff' : '#00d4ff',
                weight: isNowHighlighted ? 4 : 3,
                fillOpacity: isNowHighlighted ? 0 : 0.35
            });

            if (!isNowHighlighted) {
                group.venueMarkers.forEach(marker => {
                    marker.setStyle({ fillOpacity: 1.0, opacity: 1.0 });
                });
            }

            group.isHighlighted = isNowHighlighted;
        });

        // Reset unused markers pool for new cluster
        this.unusedMarkers = [];

        // Restart blinking with new highlighted cluster
        this.startBlinking();
    }

    /**
     * Handle cluster marker click (zoom in)
     * @param {Object} e - Leaflet event
     */
    handleClusterClick(e) {
        const marker = e.target;
        this.map.setView(marker.getLatLng(), this.map.getZoom() + 2);
    }

    /**
     * Select and highlight a marker
     * @param {Object} marker - Marker to select
     * @param {number} index - Index in displayedMarkers array
     */
    selectMarker(marker, index) {
        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());

        // Reset previous selection
        if (this.currentSelectedMarkerId !== -1 && this.currentSelectedMarkerId !== index) {
            const prevMarker = this.displayedMarkers[this.currentSelectedMarkerId];
            if (prevMarker && prevMarker !== marker && !prevMarker.isCluster) {
                this.markerFactory.resetMarker(prevMarker, radius);
            }
        }

        // Highlight new selection
        this.markerFactory.highlightMarker(marker, radius);
        if (this.isOSL) {
            this.showStageInPanel(marker.venueData);
        } else {
            marker.openPopup();
        }
        this.currentSelectedMarkerId = index;
    }

    /**
     * Handle map click for marker selection
     * @param {Object} e - Leaflet event
     */
    handleMapClick(e) {
        let nearestMarker = null;
        let nearestDistance = Infinity;
        let nearestIndex = -1;

        // Find nearest marker with popup
        this.displayedMarkers.forEach((marker, index) => {
            // In festival mode markers carry no popup — their readout goes to the fixed
            // panel — so selectability keys off venue data instead.
            if (marker._popup || (this.isOSL && marker.venueData)) {
                const distance = marker.getLatLng().distanceTo(e.latlng);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestMarker = marker;
                    nearestIndex = index;
                }
            }
        });

        if (!nearestMarker) return;

        // Use selectMarker method for consistent behavior
        this.selectMarker(nearestMarker, nearestIndex);
    }

    /**
     * Load venue data and create raw markers
     * @param {Array} venueData - Array of venue objects from API
     */
    loadVenueData(venueData) {
        this.rawVenueData = venueData;
        this.rawMarkers = [];

        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());

        venueData.forEach((venue) => {
            const marker = this.markerFactory.createVenueMarker(venue, radius);

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                const index = this.displayedMarkers.indexOf(marker);
                if (index !== -1) this.selectMarker(marker, index);
            });

            this.rawMarkers.push(marker);
        });

        if (this.isOSL) this.addTimeSlider();

        // Initial display
        this.showClusteredMarkers();

        // Needs displayedMarkers, so it runs after the first render.
        if (this.isOSL) this.autoSelectStage();
    }

    /**
     * Add the bottom time slider and keep the open popup in sync with it.
     * Its range comes from the data rather than being hardcoded, so it still frames the
     * day correctly if set times shift or a different day is being shown.
     */
    addTimeSlider() {
        // Closing the panel has to clear the selection too, or the stage stays magenta
        // with nothing open to explain why.
        this.stagePanel = new StagePanel({ onClose: () => this.deselectMarker() });

        this.timeSlider = new TimeSlider({
            startHour: 12,   // noon
            endHour: 24,     // midnight
            onChange: () => this.refreshStagePanel(),
        });

        // getMinutes() already returns the real clock while the slider is untouched — its
        // 45-minute notches cannot land exactly on now, and rounding 4:42 to 4:45 can fall
        // in the next act's slot and mislabel the live set.
        this.markerFactory.getTimeContext = () => ({
            minutes: this.timeSlider.getMinutes(),
            realNow: nowMinutesSF(),
            custom: !this.timeSlider.isNow(),
        });
    }

    /** Drop the current selection and put the marker back to its normal colour. */
    deselectMarker() {
        if (this.currentSelectedMarkerId === -1) return;
        const marker = this.displayedMarkers[this.currentSelectedMarkerId];
        if (marker && !marker.isCluster) {
            this.markerFactory.resetMarker(marker, this.clusteringEngine.getZoomRadius(this.map.getZoom()));
        }
        this.currentSelectedMarkerId = -1;
    }

    /**
     * Open a stage on load so the map arrives with something to read. Prefers whichever
     * stage the visitor is standing nearest; falls back to Lands End if location is
     * refused, unavailable, or simply never answered.
     */
    autoSelectStage() {
        const stages = this.displayedMarkers.filter((m) => m.venueData?.url === 'www.sfoutsidelands.com');
        if (!stages.length) return;

        const pick = (marker) => {
            const index = this.displayedMarkers.indexOf(marker);
            if (index !== -1) this.selectMarker(marker, index);
        };
        const fallback = () => {
            if (this.currentSelectedMarkerId !== -1) return;   // already resolved
            pick(stages.find((m) => /lands end/i.test(m.venueData.venue)) || stages[0]);
        };

        if (!navigator.geolocation) return fallback();

        // An unanswered permission prompt fires no callback at all, so back the browser's
        // own timeout with our own — otherwise the map could sit empty indefinitely.
        const guard = setTimeout(fallback, 9000);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(guard);
                if (this.currentSelectedMarkerId !== -1) return;
                const here = L.latLng(pos.coords.latitude, pos.coords.longitude);
                const nearest = stages.reduce((best, m) =>
                    here.distanceTo(m.getLatLng()) < here.distanceTo(best.getLatLng()) ? m : best);
                pick(nearest);
            },
            () => { clearTimeout(guard); fallback(); },
            { timeout: 8000, maximumAge: 300000 }
        );
    }

    /** Show a stage's act for the selected time in the fixed panel above the park. */
    showStageInPanel(venue) {
        if (!this.stagePanel) return;
        this.stagePanel.show(
            venue,
            this.markerFactory.buildSingleEvent(venue.events, this.markerFactory.getTimeContext())
        );
    }

    /** Keep the panel in step with the time slider. */
    refreshStagePanel() {
        if (!this.stagePanel || !this.stagePanel.isOpen()) return;
        const venue = this.stagePanel.venue;
        this.stagePanel.update(
            this.markerFactory.buildSingleEvent(venue.events, this.markerFactory.getTimeContext())
        );
    }

    /**
     * Update displayed markers based on filtered data
     * @param {Array} filteredData - Filtered venue data
     */
    updateMarkers(filteredData) {
        // Remove all displayed markers
        this.displayedMarkers.forEach(marker => this.map.removeLayer(marker));
        this.displayedMarkers = [];
        this.rawMarkers = [];

        // Create new markers from filtered data
        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());
        filteredData.forEach(venue => {
            const marker = this.markerFactory.createVenueMarker(venue, radius);
            this.rawMarkers.push(marker);
        });

        // Display based on zoom level
        if (this.map.getZoom() > 16) {
            this.showIndividualMarkers();
        } else {
            this.showClusteredMarkers();
        }
    }

    /**
     * Get current map zoom level
     */
    getZoom() {
        return this.map.getZoom();
    }

    /**
     * Get raw venue data
     */
    getRawVenueData() {
        return this.rawVenueData;
    }
}
