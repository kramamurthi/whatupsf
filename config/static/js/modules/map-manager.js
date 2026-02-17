/**
 * MapManager - Handles Leaflet map initialization and marker management
 */
import { ClusteringEngine } from './clustering.js';
import { MarkerFactory } from './markers.js';

export class MapManager {
    constructor(mapElementId, stadiaApiKey, useConvexHull = false) {
        this.mapElementId = mapElementId;
        this.stadiaApiKey = stadiaApiKey;
        this.useConvexHull = useConvexHull;
        this.map = null;
        this.clusteringEngine = new ClusteringEngine();
        this.markerFactory = new MarkerFactory();

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

        // Initialize map with dark tiles
        this.map = L.map(this.mapElementId, {
            center: [37.7749, -122.4494], // San Francisco center (shifted west)
            zoom: 11,
            minZoom: 11,
            maxZoom: 17,
            zoomControl: false,
            layers: [darkTiles]
        });

        // Disable scroll wheel zoom (use pinch on mobile)
        this.map.scrollWheelZoom.disable();

        // Add zoom control to bottom-left
        L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

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
     * Add custom locate-me control
     */
    addLocateMeControl() {
        let userMarker = null;
        let userCircle = null;

        const updateUserPos = (latlng, accuracy) => {
            if (!userMarker) {
                userMarker = L.marker(latlng, { title: "You are here" }).addTo(this.map);
            } else {
                userMarker.setLatLng(latlng);
            }

            // Remove and recreate circle to avoid animation glitches on zoom
            if (userCircle) {
                this.map.removeLayer(userCircle);
            }
            userCircle = L.circle(latlng, {
                radius: accuracy || 25,
                color: '#136AEC',
                fillColor: '#136AEC',
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
                btn.title = "Locate me";
                btn.innerHTML = "📍";

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(btn, "click", (e) => {
                    e.preventDefault();

                    if (!("geolocation" in navigator)) {
                        alert("Geolocation not supported on this device/browser.");
                        return;
                    }

                    map.locate({
                        setView: true,
                        maxZoom: 16,
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
            if (!userMarker.getPopup()) {
                userMarker.bindPopup("You are here").openPopup();
            }
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
            marker.setRadius(radius * 0.2);
            marker.setStyle({
                color: this.markerFactory.venueColor,
                weight: 1,
                fillColor: this.markerFactory.venueColor,
                fillOpacity: 1.0
            });

            marker.addTo(this.map);

            // Update classes immediately after adding
            const element = marker.getElement();
            if (element) {
                element.classList.remove('venue-selected');
                element.classList.add('venue-jewel-blink');
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

        // Cluster the raw markers
        const clusters = this.clusteringEngine.cluster(this.rawMarkers, clusterSize);

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

                // First, add all individual venue markers (small red)
                cluster.mlist.forEach(venueMarker => {
                    venueMarker.setRadius(radius * 0.2);
                    venueMarker.setStyle({
                        color: this.markerFactory.venueColor,
                        weight: 1,
                        fillColor: this.markerFactory.venueColor,
                        fillOpacity: 1.0
                    });

                    venueMarker.addTo(this.map);
                    this.displayedMarkers.push(venueMarker);

                    // Update classes - only blink if in closest cluster
                    const element = venueMarker.getElement();
                    if (element) {
                        element.classList.remove('venue-selected', 'venue-jewel-blink');
                        if (isClosest) {
                            element.classList.add('venue-jewel-blink');
                        }
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
                // Single venue - show as small red
                const marker = cluster.mlist[0];

                marker.setRadius(radius * 0.2);
                marker.setStyle({
                    color: this.markerFactory.venueColor,
                    weight: 1,
                    fillColor: this.markerFactory.venueColor,
                    fillOpacity: 1.0
                });

                marker.addTo(this.map);
                this.displayedMarkers.push(marker);

                // Update classes immediately after adding
                const element = marker.getElement();
                if (element) {
                    element.classList.remove('venue-selected');
                    element.classList.add('venue-jewel-blink');
                }
            }
        });

        // Start blinking effect for highlighted cluster
        this.startBlinking();
    }

    /**
     * Start blinking effect for markers (one at a time, random without replacement)
     */
    startBlinking() {
        // Clear any existing interval
        if (this.blinkInterval) {
            clearInterval(this.blinkInterval);
        }

        let currentBlinkingMarker = null;

        this.blinkInterval = setInterval(() => {
            // Reset previous blinking marker
            if (currentBlinkingMarker) {
                currentBlinkingMarker.setStyle({
                    fillOpacity: 1.0,
                    opacity: 1.0
                });
            }

            // Find highlighted group
            const highlightedGroup = this.clusterGroups.find(g => g.isHighlighted);
            if (highlightedGroup && highlightedGroup.venueMarkers.length > 0) {
                // Initialize unused markers pool if empty
                if (this.unusedMarkers.length === 0) {
                    this.unusedMarkers = [...highlightedGroup.venueMarkers];
                }

                // Pick random marker from unused pool (random without replacement)
                const randomIndex = Math.floor(Math.random() * this.unusedMarkers.length);
                currentBlinkingMarker = this.unusedMarkers[randomIndex];

                // Remove from unused pool
                this.unusedMarkers.splice(randomIndex, 1);

                // Make it blink (dim it)
                currentBlinkingMarker.setStyle({
                    fillOpacity: 0.2,
                    opacity: 0.2
                });
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

            // Reset markers to full opacity if not highlighted
            if (!isNowHighlighted) {
                group.venueMarkers.forEach(marker => {
                    marker.setStyle({
                        fillOpacity: 1.0,
                        opacity: 1.0
                    });
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
        marker.openPopup();
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
            if (marker._popup) {
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

            // Add click handler for direct marker selection
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                // Find marker's index in displayedMarkers
                const index = this.displayedMarkers.indexOf(marker);
                if (index !== -1) {
                    this.selectMarker(marker, index);
                }
            });

            this.rawMarkers.push(marker);
        });

        // Initial display
        this.showClusteredMarkers();
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
