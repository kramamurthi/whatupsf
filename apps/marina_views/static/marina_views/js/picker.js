/**
 * Marina Views - camera position picker.
 *
 * Click the map to choose where the pinhole camera stands. The ground
 * elevation comes from the USGS 3DEP terrain model server-side; the slider
 * adds structure height on top of it.
 *
 * Map configuration deliberately mirrors the events map (Leaflet 1.9.4,
 * Stadia alidade_smooth_dark, same centre) so the two feel like one site.
 */

const CONFIG = window.MARINA_CONFIG || {};

const SF_CENTRE = [37.7749, -122.4494];
const DEFAULT_ZOOM = 13;

const el = {
    hint: document.getElementById('marina-hint'),
    readout: document.getElementById('marina-readout'),
    coords: document.getElementById('marina-coords'),
    ground: document.getElementById('marina-ground'),
    height: document.getElementById('marina-height'),
    heightLabel: document.getElementById('marina-height-label'),
    total: document.getElementById('marina-total'),
    error: document.getElementById('marina-error'),
};

const state = {
    lat: null,
    lng: null,
    groundM: null,
};

let map = null;
let marker = null;

function initMap() {
    const tiles = L.tileLayer(
        `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${CONFIG.stadiaApiKey}`,
        {
            maxZoom: 20,
            attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
    );

    map = L.map('marina-map', {
        center: SF_CENTRE,
        zoom: DEFAULT_ZOOM,
        minZoom: 9,
        maxZoom: 17,
        zoomControl: false,
        layers: [tiles],
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    map.on('click', (event) => selectPoint(event.latlng.lat, event.latlng.lng));
}

async function selectPoint(lat, lng) {
    state.lat = lat;
    state.lng = lng;

    if (marker) {
        marker.setLatLng([lat, lng]);
    } else {
        marker = L.circleMarker([lat, lng], {
            radius: 7,
            color: '#00f0ff',
            weight: 2,
            fillColor: '#00f0ff',
            fillOpacity: 0.4,
        }).addTo(map);
    }

    el.hint.classList.add('hidden');
    el.readout.classList.remove('hidden');
    el.error.classList.add('hidden');
    el.coords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    el.ground.textContent = 'reading…';
    el.total.textContent = '—';

    try {
        const url = `${CONFIG.elevationUrl}?lat=${lat}&lng=${lng}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        state.groundM = data.elevation_m;
        el.ground.textContent = `${data.elevation_m.toFixed(1)} m`;
        render();
    } catch (error) {
        state.groundM = null;
        el.ground.textContent = '—';
        el.error.textContent = `Could not read elevation: ${error.message}`;
        el.error.classList.remove('hidden');
    }
}

function render() {
    const added = Number(el.height.value);
    el.heightLabel.textContent = `${added} m`;

    if (state.groundM === null) {
        el.total.textContent = '—';
        return;
    }
    el.total.textContent = `${(state.groundM + added).toFixed(1)} m`;
}

el.height.addEventListener('input', render);

initMap();
render();
