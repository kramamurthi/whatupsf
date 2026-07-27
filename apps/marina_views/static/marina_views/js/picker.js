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

// Elevations are stored and computed in metres because that is what the DEM
// provides; feet appear only on screen. The slider itself reads in feet.
const M_TO_FT = 3.280839895;

const MAX_ADDED_FT = 250;

// Inline SVG so the pin needs no image assets from the Leaflet CDN.
const PIN_ICON = L.divIcon({
    className: 'marina-pin',
    html: `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
             <path d="M13 33C13 33 24 19.5 24 12A11 11 0 1 0 2 12C2 19.5 13 33 13 33Z"
                   fill="#00f0ff" fill-opacity="0.9" stroke="#04070f" stroke-width="1.5"/>
             <circle cx="13" cy="12" r="4.2" fill="#04070f"/>
           </svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
});

const el = {
    hint: document.getElementById('marina-hint'),
    readout: document.getElementById('marina-readout'),
    coords: document.getElementById('marina-coords'),
    ground: document.getElementById('marina-ground'),
    height: document.getElementById('marina-height'),
    heightLabel: document.getElementById('marina-height-label'),
    total: document.getElementById('marina-total'),
    error: document.getElementById('marina-error'),
    open: document.getElementById('marina-open'),
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

/**
 * Place the camera at a point and read its ground elevation.
 *
 * `desiredAltM` restores a previous total altitude — used when returning from
 * the rendered view — by backing out how much structure height it implied.
 */
async function selectPoint(lat, lng, desiredAltM = null) {
    state.lat = lat;
    state.lng = lng;

    if (marker) {
        marker.setLatLng([lat, lng]);
    } else {
        marker = L.marker([lat, lng], { icon: PIN_ICON, keyboard: false }).addTo(map);
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
        el.ground.textContent = `${Math.round(data.elevation_m * M_TO_FT)} ft`;

        if (desiredAltM !== null) {
            const addedFt = (desiredAltM - data.elevation_m) * M_TO_FT;
            el.height.value = Math.min(MAX_ADDED_FT, Math.max(0, Math.round(addedFt / 5) * 5));
        }
        render();
    } catch (error) {
        state.groundM = null;
        el.ground.textContent = '—';
        el.error.textContent = `Could not read elevation: ${error.message}`;
        el.error.classList.remove('hidden');
    }
}

function render() {
    const addedFt = Number(el.height.value);
    el.heightLabel.textContent = `${addedFt} ft`;

    if (state.groundM === null) {
        el.total.textContent = '—';
        return;
    }
    const totalFt = state.groundM * M_TO_FT + addedFt;
    el.total.textContent = `${Math.round(totalFt)} ft`;
}

el.height.addEventListener('input', render);

el.open.addEventListener('click', () => {
    if (state.groundM === null) return;
    // The API speaks metres; the slider speaks feet.
    const altM = state.groundM + Number(el.height.value) / M_TO_FT;
    const query = new URLSearchParams({
        lat: state.lat.toFixed(6),
        lng: state.lng.toFixed(6),
        alt: altM.toFixed(1),
    });
    window.location.href = `${CONFIG.frustumUrl}?${query}`;
});

/** Restore a selection handed back in the query string, e.g. after Esc. */
function restoreFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lng = parseFloat(params.get('lng'));
    const alt = parseFloat(params.get('alt'));
    if (!isFinite(lat) || !isFinite(lng)) return;

    map.setView([lat, lng], Math.max(map.getZoom(), 14));
    selectPoint(lat, lng, isFinite(alt) ? alt : null);
}

initMap();
restoreFromQuery();
render();
