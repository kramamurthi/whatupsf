/**
 * WhatUpSF Map Application - Main Entry Point
 * Modern ES6+ JavaScript replacing jQuery 1.7.1
 */
import { MapManager } from './modules/map-manager.js';
import { FilterManager } from './modules/filters.js';
import { UIManager } from './modules/ui.js';

class WhatUpSFApp {
    constructor() {
        // Stadia Maps API key
        this.stadiaApiKey = '1ce6d341-6ad2-4e0e-a58f-9948f9f8d224';

        // Initialize managers
        this.mapManager = null;
        this.filterManager = null;
        this.uiManager = new UIManager();

        // State
        this.isInitialized = false;
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            console.log('🚀 Initializing WhatUpSF Map Application...');
            console.log('📍 Dark theme enabled');

            // Initialize UI first
            this.uiManager.initialize();
            this.uiManager.setupResponsive();
            this.uiManager.showLoading('Initializing map...');

            // Initialize map
            console.log('🗺️ Loading Leaflet map with dark tiles...');
            this.mapManager = new MapManager('map', this.stadiaApiKey);
            this.mapManager.initialize();
            console.log('✅ Map initialized');

            // Initialize filter manager
            this.filterManager = new FilterManager(this.mapManager);
            this.filterManager.initialize();

            // Load venue data
            await this.loadVenueData();

            // Hide loading indicator
            this.uiManager.hideLoading();

            this.isInitialized = true;
            console.log('✅ WhatUpSF Map Application initialized successfully!');
            console.log('🎨 Dark theme active with neon accents');

        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            console.error('Error details:', error.stack);
            this.uiManager.hideLoading();
            this.uiManager.showToast('Failed to load map. Please refresh the page.', 'error');
        }
    }

    /**
     * Load venue data from API
     */
    async loadVenueData() {
        try {
            this.uiManager.showLoading('Loading events...');

            // Fetch data with cache-busting parameter
            const response = await fetch('/api/map-data.json?v=20250810');

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            console.log(`Loaded ${data.length} venues with events`);

            // Load data into map
            this.mapManager.loadVenueData(data);

            // Update event count
            this.filterManager.updateEventCount(data);

            this.uiManager.showToast(`Loaded ${data.length} venues`, 'success');

        } catch (error) {
            console.error('Failed to load venue data:', error);
            throw error;
        }
    }

    /**
     * Get application version
     */
    getVersion() {
        return '2.0.0-modern';
    }

    /**
     * Get debug info
     */
    getDebugInfo() {
        return {
            version: this.getVersion(),
            initialized: this.isInitialized,
            venueCount: this.mapManager?.getRawVenueData()?.length || 0,
            currentZoom: this.mapManager?.getZoom() || 0,
            filters: this.filterManager?.filters || {}
        };
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.whatUpSFApp = new WhatUpSFApp();
        window.whatUpSFApp.init();
    });
} else {
    // DOM already loaded
    window.whatUpSFApp = new WhatUpSFApp();
    window.whatUpSFApp.init();
}

// Expose debug info to console
console.log('WhatUpSF Map App loaded. Access debug info with: window.whatUpSFApp.getDebugInfo()');
