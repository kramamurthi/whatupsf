/**
 * UIManager - Handles mobile UI interactions and animations
 */
export class UIManager {
    constructor() {
        this.filterDrawerOpen = false;
        this.bottomSheetOpen = false;
    }

    /**
     * Initialize UI event listeners
     */
    initialize() {
        this.setupMobileFilterDrawer();
        this.setupBottomSheet();
        this.setupLoadingIndicator();
    }

    /**
     * Setup mobile filter drawer toggle
     */
    setupMobileFilterDrawer() {
        const mobileFilterBtn = document.getElementById('mobile-filter-btn');
        const filterDrawer = document.getElementById('filter-drawer');
        const closeDrawerBtn = document.getElementById('close-filter-drawer');

        if (mobileFilterBtn && filterDrawer) {
            mobileFilterBtn.addEventListener('click', () => {
                this.toggleFilterDrawer();
            });
        }

        if (closeDrawerBtn && filterDrawer) {
            closeDrawerBtn.addEventListener('click', () => {
                this.closeFilterDrawer();
            });
        }

        // Close drawer when clicking outside
        if (filterDrawer) {
            document.addEventListener('click', (e) => {
                if (this.filterDrawerOpen &&
                    !filterDrawer.contains(e.target) &&
                    !mobileFilterBtn?.contains(e.target)) {
                    this.closeFilterDrawer();
                }
            });
        }
    }

    /**
     * Toggle mobile filter drawer
     */
    toggleFilterDrawer() {
        const drawer = document.getElementById('filter-drawer');
        if (!drawer) return;

        if (this.filterDrawerOpen) {
            this.closeFilterDrawer();
        } else {
            this.openFilterDrawer();
        }
    }

    /**
     * Open mobile filter drawer
     */
    openFilterDrawer() {
        const drawer = document.getElementById('filter-drawer');
        if (!drawer) return;

        drawer.classList.add('open');
        this.filterDrawerOpen = true;

        // Add fade-in animation
        drawer.style.animation = 'slideInRight 0.3s ease-out';
    }

    /**
     * Close mobile filter drawer
     */
    closeFilterDrawer() {
        const drawer = document.getElementById('filter-drawer');
        if (!drawer) return;

        drawer.classList.remove('open');
        this.filterDrawerOpen = false;
    }

    /**
     * Setup bottom sheet for event details (mobile)
     */
    setupBottomSheet() {
        const bottomSheet = document.getElementById('event-bottom-sheet');
        if (!bottomSheet) return;

        let startY = 0;
        let currentY = 0;

        // Touch event handlers for swipe gesture
        bottomSheet.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
        });

        bottomSheet.addEventListener('touchmove', (e) => {
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;

            if (deltaY > 0) {
                // Swiping down
                bottomSheet.style.transform = `translateY(${deltaY}px)`;
            }
        });

        bottomSheet.addEventListener('touchend', (e) => {
            const deltaY = currentY - startY;

            if (deltaY > 100) {
                // Swipe threshold met - close bottom sheet
                this.closeBottomSheet();
            } else {
                // Return to original position
                bottomSheet.style.transform = 'translateY(0)';
            }
        });
    }

    /**
     * Open bottom sheet
     * @param {string} content - HTML content to display
     */
    openBottomSheet(content) {
        const bottomSheet = document.getElementById('event-bottom-sheet');
        if (!bottomSheet) return;

        bottomSheet.innerHTML = `
            <div class="drag-handle"></div>
            <div class="bottom-sheet-content">
                ${content}
            </div>
        `;

        bottomSheet.classList.add('open');
        this.bottomSheetOpen = true;
    }

    /**
     * Close bottom sheet
     */
    closeBottomSheet() {
        const bottomSheet = document.getElementById('event-bottom-sheet');
        if (!bottomSheet) return;

        bottomSheet.classList.remove('open');
        this.bottomSheetOpen = false;
    }

    /**
     * Setup loading indicator
     */
    setupLoadingIndicator() {
        // Loading indicator is shown by default in HTML
        // This method provides functions to hide/show it
    }

    /**
     * Show loading indicator
     * @param {string} message - Optional loading message
     */
    showLoading(message = 'Loading events...') {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (!loadingIndicator) return;

        loadingIndicator.style.display = 'block';
        const messageEl = loadingIndicator.querySelector('p');
        if (messageEl) {
            messageEl.textContent = message;
        }
    }

    /**
     * Hide loading indicator
     */
    hideLoading() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (!loadingIndicator) return;

        loadingIndicator.style.display = 'none';
    }

    /**
     * Show toast notification
     * @param {string} message - Notification message
     * @param {string} type - Toast type: 'success', 'error', 'info'
     */
    showToast(message, type = 'info') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 right-4 z-[2000] px-6 py-3 rounded-lg shadow-lg text-white animate-slide-up`;

        // Set background color based on type
        if (type === 'success') {
            toast.classList.add('bg-green-600');
        } else if (type === 'error') {
            toast.classList.add('bg-red-600');
        } else {
            toast.classList.add('bg-blue-600');
        }

        toast.textContent = message;

        // Add to DOM
        document.body.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
    }

    /**
     * Add smooth scroll to element
     * @param {string} elementId - ID of element to scroll to
     */
    smoothScrollTo(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }

    /**
     * Check if mobile viewport
     * @returns {boolean}
     */
    isMobile() {
        return window.innerWidth < 768;
    }

    /**
     * Setup responsive event listeners
     */
    setupResponsive() {
        let resizeTimer;

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                // Close mobile drawer if switching to desktop
                if (!this.isMobile() && this.filterDrawerOpen) {
                    this.closeFilterDrawer();
                }
            }, 250);
        });
    }
}

// Add fadeOut keyframe animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
`;
document.head.appendChild(style);
