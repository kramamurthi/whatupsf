"""Ray-cast a 360 degree horizon profile from a camera position.

Why the whole circle when the camera only shows 100 degrees: the user pans
continuously, and a full profile is small (a few thousand numbers). Computing
it once means panning never touches the network.

Sampling is two-tier, because a single grid cannot serve both ends of the
problem:

  * a **region grid** at ~92m covering the entire tile set, built once and
    cached to disk. Distant ridges are what it is for, and at 40km one
    quarter-degree of azimuth is already 175m wide, so 92m is ample.
  * a **near grid** at the DEM's native ~10m, a small window read per camera.
    The hill one block north is what blocks your view, and it needs detail.

Downsampling uses `Resampling.max` rather than an average: for a skyline the
question is "does anything in this cell block the view", so the tallest point
in the cell is the honest representative. It errs toward occluding.
"""

import math
import os

import numpy as np
import rasterio
from django.conf import settings
from rasterio.windows import Window

from . import camera

#: 3DEP 1/3 arc-second cell size, in degrees.
NATIVE_DEG = 1.0 / 10800.0

#: Region grid decimation. 9 divides 10800 exactly, keeping the coarse grid
#: aligned to the native lattice, and gives ~92m cells.
REGION_DECIMATION = 9

#: Bounds of the downloaded tile set: n38w123, n39w123, n38w122, n39w122.
REGION_BOUNDS = (-123.0, 37.0, -121.0, 39.0)  # west, south, east, north

#: Radius covered by the high-resolution near grid.
NEAR_RADIUS_M = 8000.0

#: How far the ray caster looks.
MAX_RANGE_M = 80000.0

#: Azimuth resolution of the output profile.
AZIMUTH_STEP_DEG = 0.25

#: Distance band edges in metres.
#:
#: Reporting only the single highest angle per azimuth would collapse the view
#: to one far skyline, hiding every nearer hill that happens to sit below it —
#: from much of San Francisco that erases Bernal Heights behind the East Bay
#: ridge. Keeping a maximum per band lets the renderer paint far-to-near, so
#: foreground hills occlude the distance and keep their own outline.
BAND_EDGES_M = (0.0, 1000.0, 2500.0, 5000.0, 10000.0, 20000.0, 40000.0, 80000.0)

SEA_LEVEL_M = 0.0

_region_cache = {}


class Grid(object):
    """A regular lat/lng array of ground elevations, sampled bilinearly."""

    def __init__(self, data, west, north, step_deg):
        self.data = data
        self.west = west
        self.north = north
        self.step = step_deg

    def sample(self, lats, lngs):
        """Bilinear elevation lookup. Points outside the grid read sea level."""
        rows = (self.north - lats) / self.step
        cols = (lngs - self.west) / self.step

        height, width = self.data.shape
        inside = ((rows >= 0) & (rows <= height - 1)
                  & (cols >= 0) & (cols <= width - 1))

        rows = np.clip(rows, 0, height - 1.001)
        cols = np.clip(cols, 0, width - 1.001)

        r0 = rows.astype(np.int32)
        c0 = cols.astype(np.int32)
        fr = rows - r0
        fc = cols - c0

        d = self.data
        top = d[r0, c0] * (1 - fc) + d[r0, c0 + 1] * fc
        bottom = d[r0 + 1, c0] * (1 - fc) + d[r0 + 1, c0 + 1] * fc
        values = top * (1 - fr) + bottom * fr

        return np.where(inside, values, SEA_LEVEL_M)


#: Native rows to pull per read while max-pooling, keeping peak memory modest.
_STRIPE_ROWS = 2048


def _read_mosaic(west, south, east, north, decimation):
    """Assemble one elevation array from every tile overlapping the box.

    `decimation` is how many native cells collapse into one output cell, and
    they collapse by *maximum*. rasterio refuses `Resampling.max` on reads
    (GDAL only offers it for warps), and averaging would erode exactly the
    ridge lines a skyline is made of — so the reduction happens here, in
    NumPy, over horizontal stripes to keep memory bounded.

    Gaps — coordinates with no downloaded tile, which here means open ocean
    west of -123 — are filled with sea level rather than raising, so a view
    near the edge of coverage degrades instead of failing.
    """
    step = NATIVE_DEG * decimation
    ncols = int(round((east - west) / step))
    nrows = int(round((north - south) / step))
    grid = np.full((nrows, ncols), SEA_LEVEL_M, dtype=np.float32)

    for tile_lat in range(int(math.floor(south)), int(math.ceil(north))):
        for tile_lng in range(int(math.floor(west)), int(math.ceil(east))):
            t_w, t_e = float(tile_lng), float(tile_lng + 1)
            t_s, t_n = float(tile_lat), float(tile_lat + 1)

            i_w, i_e = max(west, t_w), min(east, t_e)
            i_s, i_n = max(south, t_s), min(north, t_n)
            if i_w >= i_e or i_s >= i_n:
                continue

            # Tiles are named for their north-west corner.
            path = os.path.join(
                str(settings.MARINA_DEM_DIR),
                'USGS_13_n{:02d}w{:03d}.tif'.format(tile_lat + 1, abs(tile_lng)))
            if not os.path.exists(path):
                continue

            # Native pixel offsets of the overlap within this tile.
            col_off = int(round((i_w - t_w) / NATIVE_DEG))
            row_off = int(round((t_n - i_n) / NATIVE_DEG))
            width = int(round((i_e - i_w) / NATIVE_DEG))
            height = int(round((i_n - i_s) / NATIVE_DEG))

            # Whole output cells only; a partial cell at the edge is dropped.
            width -= width % decimation
            height -= height % decimation
            if width <= 0 or height <= 0:
                continue

            out_c0 = int(round((i_w - west) / step))
            out_r0 = int(round((north - i_n) / step))
            stripe = max(decimation, (_STRIPE_ROWS // decimation) * decimation)

            with rasterio.open(path) as reader:
                for y in range(0, height, stripe):
                    rows = min(stripe, height - y)
                    rows -= rows % decimation
                    if rows <= 0:
                        break

                    patch = reader.read(1, window=Window(
                        col_off, row_off + y, width, rows)).astype(np.float32)
                    patch[patch < -1000.0] = SEA_LEVEL_M

                    if decimation > 1:
                        patch = patch.reshape(
                            rows // decimation, decimation,
                            width // decimation, decimation).max(axis=(1, 3))

                    r0 = out_r0 + y // decimation
                    grid[r0:r0 + patch.shape[0],
                         out_c0:out_c0 + patch.shape[1]] = patch

    return grid


def region_grid():
    """Coarse elevation grid over the whole tile set, built once.

    The first build reads every tile in full and takes tens of seconds, so the
    result is cached to disk next to the tiles. Later processes memory-map it.
    """
    cached = _region_cache.get('grid')
    if cached is not None:
        return cached

    west, south, east, north = REGION_BOUNDS
    step = NATIVE_DEG * REGION_DECIMATION
    path = os.path.join(str(settings.MARINA_DEM_DIR),
                        'region_grid_k{}.npy'.format(REGION_DECIMATION))

    if os.path.exists(path):
        data = np.load(path, mmap_mode='r')
    else:
        data = _read_mosaic(west, south, east, north, REGION_DECIMATION)
        # Write through a handle: np.save() would otherwise append another
        # ".npy" to the temporary name and the rename would miss.
        tmp = path + '.tmp'
        with open(tmp, 'wb') as handle:
            np.save(handle, data)
        os.replace(tmp, path)
        data = np.load(path, mmap_mode='r')

    grid = Grid(data, west, north, step)
    _region_cache['grid'] = grid
    return grid


def near_grid(lat, lng, radius_m=NEAR_RADIUS_M):
    """Native-resolution grid for the camera's immediate surroundings."""
    dlat = radius_m / 111320.0
    dlng = radius_m / (111320.0 * math.cos(math.radians(lat)))
    return Grid(
        _read_mosaic(lng - dlng, lat - dlat, lng + dlng, lat + dlat, 1),
        lng - dlng, lat + dlat, NATIVE_DEG)


def _sample_ranges():
    """Distances to sample along each ray, finer close in.

    Angular error matters most nearby: at 500m a 20m step is a small fraction
    of a degree, while at 40km a 400m step still resolves far better than the
    quarter-degree azimuth spacing.
    """
    return np.concatenate([
        np.arange(20.0, 2000.0, 20.0),
        np.arange(2000.0, 20000.0, 100.0),
        np.arange(20000.0, MAX_RANGE_M, 400.0),
    ])


def terrain_profile(lat, lng, camera_elevation_m):
    """Terrain elevation angles per azimuth, split into distance bands.

    Returns a dict ready to serialise. `profile` holds one entry per azimuth,
    starting due north and running clockwise; each entry is a list of the
    highest elevation angle found in each band of `bands`, nearest band first.

    A band with no terrain above water reports the angle of the sea surface at
    that range, which is slightly negative — exactly what a camera sees.
    """
    azimuths = np.arange(0.0, 360.0, AZIMUTH_STEP_DEG)
    ranges = _sample_ranges()

    az = np.radians(azimuths)[:, None]
    rng = ranges[None, :]

    # Equirectangular offset is accurate to well under a pixel at these ranges.
    lat_scale = 1.0 / 111320.0
    lng_scale = 1.0 / (111320.0 * math.cos(math.radians(lat)))
    lats = lat + rng * np.cos(az) * lat_scale
    lngs = lng + rng * np.sin(az) * lng_scale

    near = ranges < NEAR_RADIUS_M
    heights = np.empty(lats.shape, dtype=np.float64)
    heights[:, near] = near_grid(lat, lng).sample(lats[:, near], lngs[:, near])
    heights[:, ~near] = region_grid().sample(lats[:, ~near], lngs[:, ~near])

    angles = camera.elevation_angle_deg(rng, heights, camera_elevation_m)

    band_angles = []
    bands = []
    for lower, upper in zip(BAND_EDGES_M, BAND_EDGES_M[1:]):
        mask = (ranges >= lower) & (ranges < upper)
        if not mask.any():
            continue
        bands.append([lower / 1000.0, upper / 1000.0])
        band_angles.append(angles[:, mask].max(axis=1))

    stacked = np.stack(band_angles, axis=1)  # (azimuths, bands)

    return {
        'lat': lat,
        'lng': lng,
        'camera_elevation_m': camera_elevation_m,
        'azimuth_step_deg': AZIMUTH_STEP_DEG,
        'max_range_km': MAX_RANGE_M / 1000.0,
        'bands': bands,
        'profile': [[round(float(a), 3) for a in row] for row in stacked],
    }
