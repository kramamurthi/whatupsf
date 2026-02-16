/**
 * FilterManager - Handles filter logic and UI updates
 */
export class FilterManager {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.filters = {
            dateFrom: null,
            dateTo: null,
            priceRanges: [],
            venueTypes: []
        };
    }

    /**
     * Initialize filter event listeners
     */
    initialize() {
        // Desktop filters
        const applyBtn = document.getElementById('apply-filters');
        const clearBtn = document.getElementById('clear-filters');
        const dateFrom = document.getElementById('date-from');
        const dateTo = document.getElementById('date-to');
        const priceCheckboxes = document.querySelectorAll('.filter-price');
        const venueTypeCheckboxes = document.querySelectorAll('.filter-venue-type');

        if (applyBtn) {
            applyBtn.addEventListener('click', () => this.applyFilters());
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearFilters());
        }

        // Mobile filters
        const mobileApplyBtn = document.getElementById('mobile-apply-filters');
        const mobileClearBtn = document.getElementById('mobile-clear-filters');

        if (mobileApplyBtn) {
            mobileApplyBtn.addEventListener('click', () => {
                this.applyFilters(true);
                this.closeMobileDrawer();
            });
        }

        if (mobileClearBtn) {
            mobileClearBtn.addEventListener('click', () => {
                this.clearFilters(true);
            });
        }

        // Sync desktop and mobile filter inputs
        if (dateFrom) {
            dateFrom.addEventListener('change', (e) => {
                const mobileInput = document.getElementById('mobile-date-from');
                if (mobileInput) mobileInput.value = e.target.value;
            });
        }

        if (dateTo) {
            dateTo.addEventListener('change', (e) => {
                const mobileInput = document.getElementById('mobile-date-to');
                if (mobileInput) mobileInput.value = e.target.value;
            });
        }

        // Initial event count
        this.updateEventCount();
    }

    /**
     * Apply current filters
     * @param {boolean} isMobile - Whether called from mobile UI
     */
    applyFilters(isMobile = false) {
        // Get filter values
        const dateFromInput = isMobile ?
            document.getElementById('mobile-date-from') :
            document.getElementById('date-from');
        const dateToInput = isMobile ?
            document.getElementById('mobile-date-to') :
            document.getElementById('date-to');
        const priceCheckboxes = isMobile ?
            document.querySelectorAll('.mobile-filter-price:checked') :
            document.querySelectorAll('.filter-price:checked');
        const venueTypeCheckboxes = isMobile ?
            document.querySelectorAll('.mobile-filter-venue-type:checked') :
            document.querySelectorAll('.filter-venue-type:checked');

        this.filters.dateFrom = dateFromInput?.value || null;
        this.filters.dateTo = dateToInput?.value || null;
        this.filters.priceRanges = Array.from(priceCheckboxes).map(cb => cb.value);
        this.filters.venueTypes = Array.from(venueTypeCheckboxes).map(cb => cb.value);

        // Filter venue data
        const allVenues = this.mapManager.getRawVenueData();
        const filteredVenues = this.filterVenues(allVenues);

        // Update map markers
        this.mapManager.updateMarkers(filteredVenues);

        // Update event count
        this.updateEventCount(filteredVenues);
    }

    /**
     * Filter venues based on current filter criteria
     * @param {Array} venues - Array of venue objects
     * @returns {Array} Filtered venues
     */
    filterVenues(venues) {
        return venues.filter(venue => {
            // Date filter (check if any events fall within date range)
            if (this.filters.dateFrom || this.filters.dateTo) {
                const hasMatchingDate = venue.events?.some(event => {
                    // For now, we don't have structured date data
                    // This is a placeholder for when date fields are available
                    return true;
                });
            }

            // Price filter
            if (this.filters.priceRanges.length > 0) {
                const hasMatchingPrice = venue.events?.some(event => {
                    const priceStr = event.eventPrice || '';
                    return this.matchesPriceRange(priceStr, this.filters.priceRanges);
                });

                if (!hasMatchingPrice) return false;
            }

            // Venue type filter
            if (this.filters.venueTypes.length > 0) {
                // This would need venue type data in the backend
                // For now, accept all if filter is active
                // In production, you'd check: venue.venueType
            }

            return true;
        });
    }

    /**
     * Check if price string matches any selected price range
     * @param {string} priceStr - Price string from event (e.g., "$5", "Free")
     * @param {Array} ranges - Selected price ranges
     * @returns {boolean}
     */
    matchesPriceRange(priceStr, ranges) {
        const price = this.parsePrice(priceStr);

        for (const range of ranges) {
            if (range === 'free' && price === 0) return true;
            if (range === '0-10' && price > 0 && price < 10) return true;
            if (range === '10-30' && price >= 10 && price <= 30) return true;
            if (range === '30+' && price > 30) return true;
        }

        return false;
    }

    /**
     * Parse price string to number
     * @param {string} priceStr - Price string (e.g., "$5", "Free", "$10-15")
     * @returns {number} Price value
     */
    parsePrice(priceStr) {
        if (!priceStr) return 0;

        const lower = priceStr.toLowerCase();
        if (lower.includes('free') || lower === '0') return 0;

        // Extract first number from string
        const match = priceStr.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    }

    /**
     * Clear all filters
     * @param {boolean} isMobile - Whether called from mobile UI
     */
    clearFilters(isMobile = false) {
        // Clear filter state
        this.filters = {
            dateFrom: null,
            dateTo: null,
            priceRanges: [],
            venueTypes: []
        };

        // Clear desktop inputs
        const dateFrom = document.getElementById('date-from');
        const dateTo = document.getElementById('date-to');
        const priceCheckboxes = document.querySelectorAll('.filter-price');
        const venueTypeCheckboxes = document.querySelectorAll('.filter-venue-type');

        if (dateFrom) dateFrom.value = '';
        if (dateTo) dateTo.value = '';
        priceCheckboxes.forEach(cb => cb.checked = false);
        venueTypeCheckboxes.forEach(cb => cb.checked = false);

        // Clear mobile inputs
        const mobileDateFrom = document.getElementById('mobile-date-from');
        const mobileDateTo = document.getElementById('mobile-date-to');
        const mobilePriceCheckboxes = document.querySelectorAll('.mobile-filter-price');
        const mobileVenueTypeCheckboxes = document.querySelectorAll('.mobile-filter-venue-type');

        if (mobileDateFrom) mobileDateFrom.value = '';
        if (mobileDateTo) mobileDateTo.value = '';
        mobilePriceCheckboxes.forEach(cb => cb.checked = false);
        mobileVenueTypeCheckboxes.forEach(cb => cb.checked = false);

        // Reset map to show all venues
        const allVenues = this.mapManager.getRawVenueData();
        this.mapManager.updateMarkers(allVenues);

        // Update event count
        this.updateEventCount(allVenues);

        if (isMobile) {
            this.closeMobileDrawer();
        }
    }

    /**
     * Update event count display
     * @param {Array} venues - Filtered venues (optional, uses all if not provided)
     */
    updateEventCount(venues = null) {
        if (!venues) {
            venues = this.mapManager.getRawVenueData();
        }

        const totalEvents = venues.reduce((sum, venue) => {
            return sum + (venue.events?.length || 0);
        }, 0);

        const countElements = [
            document.getElementById('event-count'),
            document.getElementById('mobile-event-count')
        ];

        countElements.forEach(el => {
            if (el) el.textContent = totalEvents;
        });
    }

    /**
     * Close mobile filter drawer
     */
    closeMobileDrawer() {
        const drawer = document.getElementById('filter-drawer');
        if (drawer) {
            drawer.classList.remove('open');
        }
    }
}
