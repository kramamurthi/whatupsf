/**
 * Marina Views - pinhole camera frustum renderer.
 *
 * The server hands us, for each azimuth, the highest terrain elevation angle
 * within each of several distance bands. Panning is therefore pure paint and
 * never touches the network.
 *
 * Bands are drawn farthest first, each filled from its ridge line down to the
 * bottom of the frame. A nearer band therefore paints over the distance below
 * its own ridge, which is what occlusion looks like, and gives every
 * foreground hill its own outline instead of collapsing the scene onto one
 * far skyline.
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

// Nearest band is a dark terrain green; the farthest hazes toward the sky so
// aerial perspective reads correctly. Neither end may be black: the nearest
// band is painted last and covers the whole lower frame, so if it is black the
// entire scene is black.
const NEAR_RGB = [34, 50, 40];
const FAR_RGB = [112, 138, 166];

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
};

const params = new URLSearchParams(window.location.search);
const camera = {
    lat: parseFloat(params.get('lat')),
    lng: parseFloat(params.get('lng')),
    alt: parseFloat(params.get('alt')),   // metres above sea level, canonical
};

let profile = null;   // [azimuth][band] -> elevation angle in degrees
let bands = [];       // [[nearKm, farKm], ...] nearest first
let stepDeg = 0.25;
let heading = 0;      // due north to start, as specified
let width = 0;
let height = 0;

/** Terrain angle for one band at an arbitrary azimuth, interpolated. */
function angleAt(azimuthDeg, band) {
    const n = profile.length;
    const pos = ((azimuthDeg % 360) + 360) % 360 / stepDeg;
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = profile[i % n][band];
    const b = profile[(i + 1) % n][band];
    return a + (b - a) * frac;
}

function bandColour(band, alpha) {
    const t = bands.length > 1 ? band / (bands.length - 1) : 0;
    const c = NEAR_RGB.map((near, i) => Math.round(near + (FAR_RGB[i] - near) * t));
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
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
    // which propagates into the profile lookup and throws. draw() can be
    // reached before the canvas has been measured, so this guard is load
    // bearing, not defensive dressing.
    if (!profile || !width || !height) return;

    const cx = width / 2;
    const cy = height / 2;
    const f = cx / Math.tan((hfovDeg / 2) * Math.PI / 180);

    const sky = ctx.createLinearGradient(0, 0, 0, cy);
    sky.addColorStop(0, '#081426');
    sky.addColorStop(1, '#35597f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Farthest band first so nearer terrain paints over it.
    for (let band = bands.length - 1; band >= 0; band--) {
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x++) {
            const dAz = Math.atan((x - cx) / f);
            const eps = angleAt(heading + dAz * 180 / Math.PI, band) * Math.PI / 180;
            ctx.lineTo(x, cy - VERTICAL_EXAGGERATION * f * Math.tan(eps) / Math.cos(dAz));
        }
        ctx.lineTo(width, height);
        ctx.closePath();

        ctx.fillStyle = bandColour(band, 1);
        ctx.fill();
        ctx.strokeStyle = bandColour(band, 0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
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
    for (let band = 0; band < bands.length; band++) {
        const [nearKm, farKm] = bands[band];
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';
        row.innerHTML =
            `<span style="width:10px;height:10px;border-radius:2px;` +
            `background:${bandColour(band, 1)};display:inline-block"></span>` +
            `<span>${(nearKm * KM_TO_MI).toFixed(1)}–` +
            `${(farKm * KM_TO_MI).toFixed(0)} mi</span>`;
        ui.legend.appendChild(row);
    }
}

function pan(deltaDeg) {
    heading = ((heading + deltaDeg) % 360 + 360) % 360;
    draw();
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

// --- load ------------------------------------------------------------------

async function load() {
    if (!isFinite(camera.lat) || !isFinite(camera.lng) || !isFinite(camera.alt)) {
        ui.status.textContent = 'No camera position given. Pick one on the map.';
        return;
    }

    ui.position.textContent =
        `${camera.lat.toFixed(4)}, ${camera.lng.toFixed(4)} @ ` +
        `${Math.round(camera.alt * M_TO_FT)} ft`;

    try {
        const url = `${CONFIG.panoramaUrl}?lat=${camera.lat}&lng=${camera.lng}&alt=${camera.alt}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        profile = data.profile;
        bands = data.bands;
        stepDeg = data.azimuth_step_deg;
        ui.status.style.display = 'none';

        // resize() measures the canvas and then draws. Nothing may call draw()
        // before this point, and no decorative step may run ahead of it.
        resize();
    } catch (error) {
        ui.status.textContent = `Could not build the view: ${error.message}`;
        return;
    }

    // The legend is decoration. If it fails the view must still stand.
    try {
        buildLegend();
    } catch (error) {
        console.warn('Marina Views: legend failed', error);
    }
}

load();
