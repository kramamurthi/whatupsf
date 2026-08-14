/**
 * Marina Views - pinhole camera frustum renderer.
 *
 * The server hands us, for each azimuth, the list of surfaces actually visible
 * along that ray: a staircase of [topAngle, distance, surfaceKind] running from
 * the bottom of the view upward. The depth test happens server-side, where the
 * heightfield lives, so panning is pure paint and never touches the network.
 *
 * Each step occupies the angular span between the previous step's top and its
 * own, and is painted in its surface's colour hazed by its own distance.
 * Everything above the last step is sky.
 *
 * An earlier version reduced each ray to one maximum angle per distance band
 * and drew band silhouettes back to front. That produced concentric outlines -
 * an artefact of the reduction, not of the terrain - because every surface in a
 * band collapsed onto a single outline. There are no bands now.
 *
 * Projection is rectilinear, as a real pinhole camera is. For a screen column
 * at horizontal offset dx from centre:
 *
 *     dAz = atan(dx / f)                     azimuth offset of that column
 *     y   = cy - k * f * tan(eps) / cos(dAz) where eps is the terrain angle
 *
 * The 1/cos(dAz) is what makes a straight horizon bow at the edges of a wide
 * lens, and why 100 degrees looks as dramatic as it does. k is a fixed
 * vertical stretch - see VERTICAL_EXAGGERATION below for why it exists and
 * what it costs. With k = 1 this is an exact pinhole projection.
 */

const CONFIG = window.MARINA_CONFIG || {};

const FOV_CHOICES = [100, 50];
let hfovDeg = 100;
const M_TO_FT = 3.280839895;
const KM_TO_MI = 0.621371192;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// One ramp per surface type, each running from its near colour to a hazy far
// colour so aerial perspective reads correctly. No ramp may bottom out at
// black: the nearest band is painted last and covers the whole lower frame, so
// a black near colour makes the entire scene black.
//
// Codes must match surfaces.py.
const SURFACE_LAND = 0;
const SURFACE_WATER = 1;
const SURFACE_STRUCTURE = 2;
const SURFACE_BRIDGE = 3;

// Buildings are a warm graphite rather than the stucco white tried earlier:
// white read as the brightest thing in frame and pulled the eye away from the
// terrain, and it fought the haze ramp, since a surface cannot both be pure
// white up close and fade into a blue distance.
//
// The bridge colour is not ours. #bf4e3b is the building:colour tag carried by
// every Golden Gate Bridge tower part in OpenStreetMap.
const PALETTE = {
    [SURFACE_LAND]:      { near: [34, 50, 40],    far: [112, 138, 166] },
    [SURFACE_WATER]:     { near: [22, 58, 92],    far: [96, 128, 162] },
    [SURFACE_STRUCTURE]: { near: [124, 118, 108], far: [146, 152, 166] },
    [SURFACE_BRIDGE]:    { near: [191, 78, 59],   far: [163, 104, 100] },
};

// A pinhole camera has no free vertical parameter: the vertical field follows
// from the horizontal one and the frame's aspect ratio,
//
//     f    = (W/2) / tan(hfov/2)
//     vfov = 2 * atan((H/2) / f)
//
// which for a 100 degree lens on a typical wide browser window is about 60
// degrees. Terrain from a low viewpoint spans only a degree or two of that, so
// a true 1:1 rendering is unreadably flat.
//
// We therefore apply a fixed 2x anamorphic stretch to the vertical axis only.
// It is a constant, not a setting: the geometry is deterministic and picking it
// is our job, not the viewer's. The consequence is explicit - vertical angles
// read twice as steep as horizontal ones, so the frame is not a photograph.
const VERTICAL_EXAGGERATION = 2;

const canvas = document.getElementById('frustum-canvas');
const ctx = canvas.getContext('2d');
const ui = {
    compass: document.getElementById('frustum-compass'),
    heading: document.getElementById('frustum-heading'),
    position: document.getElementById('frustum-position'),
    status: document.getElementById('frustum-status'),
    legend: document.getElementById('frustum-legend'),
    height: document.getElementById('frustum-height'),
    added: document.getElementById('frustum-added'),
    total: document.getElementById('frustum-total'),
    ground: document.getElementById('frustum-ground'),
};

const params = new URLSearchParams(window.location.search);
const camera = {
    lat: parseFloat(params.get('lat')),
    lng: parseFloat(params.get('lng')),
    alt: parseFloat(params.get('alt')),   // metres above sea level, canonical
};

let columns = null;   // [azimuth] -> [[topAngleDeg, distanceKm, surface], ...]
let stepDeg = 0.25;
let heading = 0;      // due north to start, as specified
let width = 0;
let height = 0;
let groundM = null;      // terrain under the camera, so the slider can show extra height
let inFlight = null;     // AbortController for the panorama request in flight
let refetchTimer = null;

/** Haze fraction for a distance: 0 right here, 1 far away. */
function hazeAt(distanceKm) {
    // Power under 1 so the first few kilometres, where most of the scene is,
    // still separate clearly instead of all reading as "near".
    return Math.min(1, Math.pow(Math.max(distanceKm, 0) / 35, 0.55));
}

function surfaceColour(surface, distanceKm) {
    const ramp = PALETTE[surface] || PALETTE[SURFACE_LAND];
    const t = hazeAt(distanceKm);
    const c = ramp.near.map((near, i) => Math.round(near + (ramp.far[i] - near) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Signed smallest difference between two bearings, in degrees. */
function bearingDelta(a, b) {
    return ((a - b + 540) % 360) - 180;
}

function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
}

function draw() {
    // A zero-width canvas makes the focal length zero, and (x - cx) / 0 is NaN,
    // which propagates into the column lookup and throws. draw() can be
    // reached before the canvas has been measured, so this guard is load
    // bearing, not defensive dressing.
    if (!columns || !width || !height) return;

    const cx = width / 2;
    const cy = height / 2;
    const f = cx / Math.tan((hfovDeg / 2) * Math.PI / 180);
    const total = columns.length;

    const sky = ctx.createLinearGradient(0, 0, 0, cy);
    sky.addColorStop(0, '#081426');
    sky.addColorStop(1, '#35597f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // One vertical strip per azimuth sample in view. Each strip paints its own
    // visible surfaces bottom-up, so occlusion is already decided and nothing
    // needs to be layered back to front.
    const half = hfovDeg / 2 + stepDeg;
    const first = Math.floor((heading - half) / stepDeg);
    const last = Math.ceil((heading + half) / stepDeg);

    for (let i = first; i <= last; i++) {
        const deltaLeft = bearingDelta(i * stepDeg, heading);
        const deltaRight = bearingDelta((i + 1) * stepDeg, heading);
        if (Math.abs(deltaLeft) > 89.5 || Math.abs(deltaRight) > 89.5) continue;

        const xLeft = cx + f * Math.tan(deltaLeft * Math.PI / 180);
        const xRight = cx + f * Math.tan(deltaRight * Math.PI / 180);
        if (xRight < 0 || xLeft > width) continue;

        const stripX = Math.floor(xLeft);
        const stripW = Math.max(1, Math.ceil(xRight) - stripX);

        // The projection's 1/cos term uses the strip's own offset, so wide
        // lenses bow the horizon exactly as a rectilinear lens does.
        const secant = 1 / Math.cos(deltaLeft * Math.PI / 180);
        const column = columns[((i % total) + total) % total];

        let bottom = height;
        for (let k = 0; k < column.length && bottom > 0; k++) {
            const angle = column[k][0];
            const distanceKm = column[k][1];
            const surface = column[k][2];

            let top = cy - VERTICAL_EXAGGERATION * f
                      * Math.tan(angle * Math.PI / 180) * secant;
            if (top >= bottom) continue;          // entirely below what we drew
            if (top < 0) top = 0;                 // clip at the frame top

            ctx.fillStyle = surfaceColour(surface, distanceKm);
            ctx.fillRect(stripX, top, stripW, bottom - top);
            bottom = top;
        }
    }

    drawCompassTicks(cx, cy, f);
    updateReadout();
}

/** Tick marks along the true horizon so the heading is legible in the scene. */
function drawCompassTicks(cx, cy, f) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';

    for (let az = 0; az < 360; az += 10) {
        const dAz = ((az - heading + 540) % 360) - 180;
        if (Math.abs(dAz) > hfovDeg / 2) continue;

        const x = cx + f * Math.tan(dAz * Math.PI / 180);
        const major = az % 45 === 0;
        ctx.beginPath();
        ctx.moveTo(x, cy - (major ? 10 : 5));
        ctx.lineTo(x, cy + (major ? 10 : 5));
        ctx.stroke();
        if (major) {
            ctx.fillText(COMPASS[Math.round(az / 22.5) % 16], x, cy - 16);
        }
    }
}

function updateReadout() {
    const norm = ((heading % 360) + 360) % 360;
    ui.compass.textContent = COMPASS[Math.round(norm / 22.5) % 16];
    ui.heading.textContent = `${norm.toFixed(0)}°`;
}

function buildLegend() {
    if (!ui.legend) return;
    ui.legend.innerHTML = '';

    for (const [code, label] of [[SURFACE_LAND, 'terrain'], [SURFACE_WATER, 'water'],
                                 [SURFACE_STRUCTURE, 'built'], [SURFACE_BRIDGE, 'bridge']]) {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';
        // Two chips per surface show how its colour hazes with distance.
        row.innerHTML =
            `<span style="width:10px;height:10px;border-radius:2px;` +
            `background:${surfaceColour(code, 0)};display:inline-block"></span>` +
            `<span style="width:10px;height:10px;border-radius:2px;` +
            `background:${surfaceColour(code, 30)};display:inline-block"></span>` +
            `<span>${label}</span>`;
        ui.legend.appendChild(row);
    }

    const note = document.createElement('div');
    note.className = 'pt-2 mt-1 border-t border-midnight-600 text-[10px] text-gray-600';
    note.textContent = 'paler = further away';
    ui.legend.appendChild(note);
}

function pan(deltaDeg) {
    heading = ((heading + deltaDeg) % 360 + 360) % 360;
    draw();
}

/**
 * Fetch the profile for the current camera altitude and redraw.
 *
 * Changing height changes the whole ray cast, so unlike panning this does need
 * the server. Requests are debounced and the previous one aborted, otherwise
 * dragging the slider queues a second of work per step.
 */
async function loadProfile() {
    if (inFlight) inFlight.abort();
    inFlight = new AbortController();

    ui.status.style.display = '';
    ui.status.textContent = 'Casting rays…';

    try {
        const url = `${CONFIG.panoramaUrl}?lat=${camera.lat}&lng=${camera.lng}&alt=${camera.alt}`;
        const response = await fetch(url, { signal: inFlight.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        columns = data.columns;
        stepDeg = data.azimuth_step_deg;
        ui.status.style.display = 'none';
        resize();
    } catch (error) {
        if (error.name === 'AbortError') return;
        ui.status.textContent = `Could not build the view: ${error.message}`;
        return;
    }

    try {
        buildLegend();
    } catch (error) {
        console.warn('Marina Views: legend failed', error);
    }
}

/** Reflect the slider in the readout, the URL, and (debounced) the profile. */
function applyHeight({ refetch = true } = {}) {
    // A non-finite ground would poison camera.alt, the URL and every request
    // that follows, so refuse rather than propagate it.
    if (groundM === null || !isFinite(groundM)) return;
    const addedFt = Number(ui.height.value);
    camera.alt = groundM + addedFt / M_TO_FT;

    ui.added.textContent = `${addedFt} ft`;
    ui.total.textContent = `${Math.round(camera.alt * M_TO_FT)} ft`;
    ui.position.textContent =
        `${camera.lat.toFixed(4)}, ${camera.lng.toFixed(4)} @ ` +
        `${Math.round(camera.alt * M_TO_FT)} ft`;

    // Keep the URL in step so a reload, a share, or Esc all carry this height.
    const query = new URLSearchParams({
        lat: camera.lat.toFixed(6), lng: camera.lng.toFixed(6),
        alt: camera.alt.toFixed(1),
    });
    window.history.replaceState(null, '', `?${query}`);

    if (!refetch) return;
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(loadProfile, 300);
}

/** Picker URL carrying the current camera, so Esc returns to this selection. */
function pickerUrlWithPosition() {
    if (!isFinite(camera.lat) || !isFinite(camera.lng)) return CONFIG.pickerUrl;
    const query = new URLSearchParams({
        lat: camera.lat.toFixed(6),
        lng: camera.lng.toFixed(6),
        alt: camera.alt.toFixed(1),
    });
    return `${CONFIG.pickerUrl}?${query}`;
}

function setFov(degrees) {
    hfovDeg = degrees;
    for (const button of document.querySelectorAll('.fov-btn')) {
        button.classList.toggle('active', Number(button.dataset.fov) === degrees);
    }
    draw();
}

for (const button of document.querySelectorAll('.fov-btn')) {
    button.addEventListener('click', () => setFov(Number(button.dataset.fov)));
}

// Highlight the default straight away; draw() no-ops until data arrives.
setFov(FOV_CHOICES[0]);

// --- input -----------------------------------------------------------------

let dragging = false;
let lastX = 0;

canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pan(-(e.clientX - lastX) * (hfovDeg / width));
    lastX = e.clientX;
});

for (const event of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(event, () => {
        dragging = false;
        canvas.classList.remove('dragging');
    });
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.location.href = pickerUrlWithPosition();
    } else if (e.key === 'ArrowLeft') {
        pan(-5);
    } else if (e.key === 'ArrowRight') {
        pan(5);
    }
});

window.addEventListener('resize', resize);
ui.height.addEventListener('input', () => applyHeight());

// --- load ------------------------------------------------------------------

async function load() {
    if (!isFinite(camera.lat) || !isFinite(camera.lng) || !isFinite(camera.alt)) {
        ui.status.textContent = 'No camera position given. Pick one on the map.';
        return;
    }

    ui.position.textContent =
        `${camera.lat.toFixed(4)}, ${camera.lng.toFixed(4)} @ ` +
        `${Math.round(camera.alt * M_TO_FT)} ft`;

    // The slider offers height *above the ground*, so we need to know where the
    // ground is before it means anything. A failure here is not fatal: the view
    // still renders at the altitude the URL asked for, only the slider is dead.
    try {
        const url = `${CONFIG.elevationUrl}?lat=${camera.lat}&lng=${camera.lng}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        if (!isFinite(data.elevation_m)) {
            throw new Error('elevation response had no usable value');
        }
        groundM = data.elevation_m;
        ui.ground.textContent = `ground ${Math.round(groundM * M_TO_FT)} ft`;

        const addedFt = Math.round((camera.alt - groundM) * M_TO_FT / 5) * 5;
        ui.height.value = Math.min(250, Math.max(0, addedFt));
        applyHeight({ refetch: false });
    } catch (error) {
        console.warn('Marina Views: ground elevation unavailable', error);
        ui.height.disabled = true;
        ui.ground.textContent = 'ground unknown';
    }

    await loadProfile();
}

load();
