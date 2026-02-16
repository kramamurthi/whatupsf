/**
 * ClusteringEngine - Modern ES6+ port of the distance-based clustering algorithm
 */
export class ClusteringEngine {
    constructor() {
        this.clusters = [];
    }

    /**
     * Calculate cluster size threshold based on zoom level
     * @param {number} zoom - Current map zoom level
     * @returns {number} Distance threshold in meters
     */
    getClusterSize(zoom) {
        return Math.pow(2, 11 - zoom) * 7000.0; // Same formula as original
    }

    /**
     * Calculate marker radius based on zoom level
     * @param {number} zoom - Current map zoom level
     * @returns {number} Radius in meters
     */
    getZoomRadius(zoom) {
        return Math.pow(2, 12 - zoom) * 512;
    }

    /**
     * Cluster markers based on distance threshold
     * @param {Array} markers - Array of Leaflet circle markers with _latlng property
     * @param {number} clusterSize - Distance threshold for clustering
     * @returns {Array} Array of cluster groups with mlist and center properties
     */
    cluster(markers, clusterSize) {
        this.clusters = [];

        for (const marker of markers) {
            this.assignToCluster(marker, clusterSize);
        }

        return this.clusters;
    }

    /**
     * Assign a marker to the nearest cluster or create new cluster
     * @param {Object} marker - Leaflet circle marker
     * @param {number} distanceThreshold - Maximum distance to join existing cluster
     */
    assignToCluster(marker, distanceThreshold) {
        // First marker - create initial cluster
        if (this.clusters.length === 0) {
            this.clusters.push({
                mlist: [marker],
                center: [marker._latlng.lat, marker._latlng.lng]
            });
            return;
        }

        // Find nearest cluster
        let minDistance = Infinity;
        let nearestClusterIndex = -1;

        for (let i = 0; i < this.clusters.length; i++) {
            const clusterCenter = L.latLng(
                this.clusters[i].center[0],
                this.clusters[i].center[1]
            );
            const distance = clusterCenter.distanceTo(marker._latlng);

            if (distance < minDistance) {
                minDistance = distance;
                nearestClusterIndex = i;
            }
        }

        // Add to nearest cluster if within threshold, otherwise create new cluster
        if (minDistance < distanceThreshold) {
            const cluster = this.clusters[nearestClusterIndex];
            const currentSize = cluster.mlist.length;

            // Add marker to cluster
            cluster.mlist.push(marker);

            // Update cluster center (weighted average)
            cluster.center[0] = (cluster.center[0] * currentSize + marker._latlng.lat) / (currentSize + 1);
            cluster.center[1] = (cluster.center[1] * currentSize + marker._latlng.lng) / (currentSize + 1);
        } else {
            // Create new cluster
            this.clusters.push({
                mlist: [marker],
                center: [marker._latlng.lat, marker._latlng.lng]
            });
        }
    }

    /**
     * Calculate the radius for a cluster marker based on its contents
     * @param {Object} cluster - Cluster with mlist property
     * @param {number} baseRadius - Base radius from zoom level
     * @returns {number} Calculated radius
     */
    calculateClusterRadius(cluster, baseRadius) {
        let maxDistance = 0;

        // Find maximum distance between any two markers in cluster
        for (let i = 0; i < cluster.mlist.length; i++) {
            for (let j = i + 1; j < cluster.mlist.length; j++) {
                const distance = cluster.mlist[i]._latlng.distanceTo(
                    cluster.mlist[j]._latlng
                );
                if (distance > maxDistance) {
                    maxDistance = distance;
                }
            }
        }

        // Calculate radius (max of 2x base radius or 0.5x max distance)
        return Math.max(2 * baseRadius, 0.5 * maxDistance);
    }

    /**
     * Reset clusters
     */
    reset() {
        this.clusters = [];
    }
}
