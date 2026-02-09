/**
 * MapManager - Handles Leaflet map initialization and marker management
 */
import { ClusteringEngine } from './clustering.js';
import { MarkerFactory } from './markers.js';

export class MapManager {
    constructor(mapElementId, stadiaApiKey) {
        this.mapElementId = mapElementId;
        this.stadiaApiKey = stadiaApiKey;
        this.map = null;
        this.clusteringEngine = new ClusteringEngine();
        this.markerFactory = new MarkerFactory();

        // State
        this.rawMarkers = [];
        this.displayedMarkers = [];
        this.currentSelectedMarkerId = -1;
        this.rawVenueData = [];
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
            center: [37.769073, -122.489147], // OSL coordinates
            zoom: 16,
            minZoom: 12,
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

            if (!userCircle) {
                userCircle = L.circle(latlng, { radius: accuracy || 25 }).addTo(this.map);
            } else {
                userCircle.setLatLng(latlng).setRadius(accuracy || 25);
            }
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
    }

    /**
     * Handle zoom level changes (switch between clustered and individual markers)
     */
    handleZoomChange() {
        const zoom = this.map.getZoom();

        // Reset selected marker highlight
        if (this.currentSelectedMarkerId !== -1) {
            const marker = this.displayedMarkers[this.currentSelectedMarkerId];
            if (marker) {
                this.markerFactory.resetMarker(marker, this.clusteringEngine.getZoomRadius(zoom));
            }
            this.currentSelectedMarkerId = -1;
        }

        // Remove all displayed markers (including number markers for clusters)
        this.displayedMarkers.forEach(marker => {
            this.map.removeLayer(marker);
            // Remove associated number marker if it's a cluster
            if (marker.numberMarker) {
                this.map.removeLayer(marker.numberMarker);
            }
        });
        this.displayedMarkers = [];

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
            marker.setRadius(radius);
            marker.addTo(this.map);
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

        // Create markers for each cluster
        clusters.forEach(cluster => {
            if (cluster.mlist.length > 1) {
                // Multiple venues - create cluster marker
                const clusterRadius = this.clusteringEngine.calculateClusterRadius(cluster, radius);
                const clusterMarker = this.markerFactory.createClusterMarker(
                    cluster,
                    clusterRadius,
                    (e) => this.handleClusterClick(e)
                );
                clusterMarker.addTo(this.map);

                // Add number marker if it exists
                if (clusterMarker.numberMarker) {
                    clusterMarker.numberMarker.addTo(this.map);
                }

                this.displayedMarkers.push(clusterMarker);
            } else {
                // Single venue - show individual marker
                const marker = cluster.mlist[0];
                marker.setRadius(radius);
                marker.addTo(this.map);
                this.displayedMarkers.push(marker);
            }
        });
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

        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());

        // Reset previous selection
        if (this.currentSelectedMarkerId !== -1) {
            const prevMarker = this.displayedMarkers[this.currentSelectedMarkerId];
            if (prevMarker) {
                this.markerFactory.resetMarker(prevMarker, radius);
            }
        }

        // Highlight new selection
        this.markerFactory.highlightMarker(nearestMarker, radius);
        nearestMarker.openPopup();
        this.currentSelectedMarkerId = nearestIndex;
    }

    /**
     * Load venue data and create raw markers
     * @param {Array} venueData - Array of venue objects from API
     */
    loadVenueData(venueData) {
        this.rawVenueData = venueData;
        this.rawMarkers = [];

        const radius = this.clusteringEngine.getZoomRadius(this.map.getZoom());

        venueData.forEach(venue => {
            const marker = this.markerFactory.createVenueMarker(venue, radius);
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
