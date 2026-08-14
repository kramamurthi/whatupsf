"""What the camera is actually looking at: land, water, or something built.

The DEM alone cannot answer this. It is a *bare earth* model, so it has no
buildings and no bridges, and it records water surfaces as sea level without
labelling them. This module adds the two things it lacks:

  * a **structure height raster**, from San Francisco's lidar-derived building
    footprints.
  * a **bridge raster**, from OpenStreetMap's 3D model of the Golden Gate
    Bridge towers — real surveyed polygons, each carrying its own height tag.
  * a **surface classification**, so the renderer can colour water blue,
    terrain green, buildings pale and the bridge in its own colour, instead of
    painting everything as undifferentiated ground.

Every number here is measured or mapped. An earlier version padded the raster
with rectangles drawn by hand for the bridges and Sutro Tower; those are gone,
and nothing replaces them except sourced geometry. A raster mixing surveyed
lidar with numbers someone typed cannot be reasoned about, and the invented
shapes were already contradicting themselves — a "north tower" whose coordinate
sat mid-span.

Coverage is honest about its edges:

  * the footprint dataset is San Francisco only, so Oakland and Sausalito have
    terrain but no buildings
  * building heights come from 2010 lidar, so anything newer is missing —
    Salesforce Tower reads as bare ground
  * the bridge *deck* carries no height anywhere in OSM, so only the towers are
    modelled. Sutro Tower is likewise absent: it is neither a building nor a
    bridge, and nothing in these sources describes it.
"""

import glob
import json
import math
import os

import numpy as np
import rasterio
from django.conf import settings
from rasterio.features import rasterize
from rasterio.transform import from_origin

#: Surface codes shared with the renderer. Keep in step with frustum.js.
SURFACE_LAND = 0
SURFACE_WATER = 1
SURFACE_STRUCTURE = 2
SURFACE_BRIDGE = 3

#: 3DEP 1/3 arc-second cell size, in degrees.
NATIVE_DEG = 1.0 / 10800.0

#: Ground at or below this counts as water. Bay and ocean read 0.00 to -0.30m
#: in the DEM while the lowest shoreline *land* measured 2.89m, so this sits in
#: a comfortable gap rather than on a knife edge.
WATER_MAX_M = 1.0

#: Bounds of the San Francisco footprint data, generously padded.
SF_BOUNDS = (-122.5300, 37.7000, -122.3500, 37.8400)  # w, s, e, n

FEET_TO_M = 0.3048

#: OpenStreetMap's own recorded colour for the Golden Gate Bridge towers
#: (building:colour on every tower part). Not a colour we picked.
BRIDGE_COLOUR = '#bf4e3b'

_cache = {}


def _osm_bridge_shapes():
    """Golden Gate Bridge tower parts, as mapped in OpenStreetMap.

    Each part is a real surveyed polygon carrying its own `height` in metres.
    The towers stand in water, so ground level is sea level and the tag value
    is already an elevation above it.

    Only elements with an explicit height are used. The bridge *deck* is mapped
    as an area (way/370672707) with no height tag anywhere in the data, so it
    is absent here rather than assigned a number we made up.
    """
    path = os.path.join(str(settings.MARINA_DEM_DIR), '..', 'osm',
                        'ggb_towers.json')
    path = os.path.normpath(path)
    if not os.path.exists(path):
        return []

    with open(path) as handle:
        elements = json.load(handle).get('elements', [])

    shapes = []
    for element in elements:
        ring = element.get('geometry')
        raw = element.get('tags', {}).get('height')
        if not ring or raw in (None, ''):
            continue
        try:
            elevation = float(raw)
        except (TypeError, ValueError):
            continue
        coords = [[(p['lon'], p['lat']) for p in ring if p.get('lat') is not None]]
        if len(coords[0]) < 4:
            continue
        if coords[0][0] != coords[0][-1]:
            coords[0].append(coords[0][0])
        shapes.append(({'type': 'Polygon', 'coordinates': coords}, elevation))

    shapes.sort(key=lambda pair: pair[1])
    return shapes


def bridge_grid():
    """Roof-height raster for mapped bridge structure, zero elsewhere."""
    cached = _cache.get('bridges')
    if cached is not None:
        return cached

    west, south, east, north = SF_BOUNDS
    shapes = _osm_bridge_shapes()
    ncols = int(round((east - west) / NATIVE_DEG))
    nrows = int(round((north - south) / NATIVE_DEG))

    if shapes:
        data = rasterize(
            shapes, out_shape=(nrows, ncols),
            transform=from_origin(west, north, NATIVE_DEG, NATIVE_DEG),
            fill=0.0, dtype='float32', all_touched=True)
    else:
        data = np.zeros((nrows, ncols), dtype='float32')

    grid = (data, west, north, NATIVE_DEG)
    _cache['bridges'] = grid
    return grid


def sample_bridges(lats, lngs):
    """Bridge structure height at each coordinate; 0 where there is none."""
    return _sample_nearest(bridge_grid(), lats, lngs,
                           radius=BRIDGE_SAMPLE_RADIUS_CELLS)


def _footprint_shapes():
    """Yield (geometry, roof_elevation_m) for every downloaded footprint.

    Sorted ascending by height so that when rasterize() burns overlapping
    polygons the tallest lands last — an effective max without needing a
    merge strategy rasterize does not offer.
    """
    directory = os.path.join(str(settings.MARINA_DEM_DIR), '..', 'sf_buildings')
    directory = os.path.normpath(directory)

    shapes = []
    for path in sorted(glob.glob(os.path.join(directory, 'page_*.geojson'))):
        with open(path) as handle:
            for feature in json.load(handle)['features']:
                geometry = feature.get('geometry')
                raw = feature['properties'].get('p2010_zmaxn88ft')
                if not geometry or raw in (None, ''):
                    continue
                try:
                    elevation = float(raw) * FEET_TO_M
                except (TypeError, ValueError):
                    continue
                shapes.append((geometry, elevation))

    shapes.sort(key=lambda pair: pair[1])
    return shapes


def structure_grid():
    """Roof elevation raster over San Francisco, zero where nothing is built.

    Built once and cached to disk beside the DEM; rasterising 177k polygons
    takes a while and the answer never changes.
    """
    cached = _cache.get('structures')
    if cached is not None:
        return cached

    west, south, east, north = SF_BOUNDS
    path = os.path.join(str(settings.MARINA_DEM_DIR), 'sf_structures.npy')

    if os.path.exists(path):
        data = np.load(path, mmap_mode='r')
    else:
        ncols = int(round((east - west) / NATIVE_DEG))
        nrows = int(round((north - south) / NATIVE_DEG))
        transform = from_origin(west, north, NATIVE_DEG, NATIVE_DEG)

        data = rasterize(
            _footprint_shapes(),
            out_shape=(nrows, ncols),
            transform=transform,
            fill=0.0,
            dtype='float32',
            all_touched=True,   # a narrow tower must not vanish between cells
        )
        tmp = path + '.tmp'
        with open(tmp, 'wb') as handle:
            np.save(handle, data)
        os.replace(tmp, path)
        data = np.load(path, mmap_mode='r')

    grid = (data, west, north, NATIVE_DEG)
    _cache['structures'] = grid
    return grid


#: Sampling window half-widths, in cells (~10m each). These differ by layer on
#: purpose, because the two layers fail in opposite directions.
#:
#: Bridges are sparse and thin: a Golden Gate tower leg is a single cell, and
#: the ray caster's angular resolution is coarser than that, so point sampling
#: walks straight past it. A ~50m window asks the right question there - "does
#: anything in this sample's footprint block the view" - and there is nothing
#: nearby for it to smear into.
#:
#: Buildings are the opposite. San Francisco streets are about 20m wide and
#: blocks about 70m, so a ~50m window maximises straight across every street
#: and welds a block into one unbroken wall. Measured on a 900m line through
#: the Marina district: a 50m window found 0 open-ground samples out of 90,
#: while point sampling found 25 and reproduced the block-and-street rhythm.
#: The gaps between buildings carry real information, so buildings are sampled
#: at a point and allowed to be missed rather than dilated.
BRIDGE_SAMPLE_RADIUS_CELLS = 2
STRUCTURE_SAMPLE_RADIUS_CELLS = 0


def _sample_nearest(grid, lats, lngs, radius=0):
    """Maximum height within a small window around each coordinate.

    Nearest-neighbour rather than bilinear at heart: a building's height is a
    step, not a slope, and interpolating would shave the tops off narrow
    towers. See SAMPLE_RADIUS_CELLS for why it is a window and not a point.
    """
    data, west, north, step = grid
    rows = np.rint((north - lats) / step).astype(np.int64)
    cols = np.rint((lngs - west) / step).astype(np.int64)

    height, width = data.shape
    inside = (rows >= 0) & (rows < height) & (cols >= 0) & (cols < width)
    np.clip(rows, 0, height - 1, out=rows)
    np.clip(cols, 0, width - 1, out=cols)

    best = np.asarray(data[rows, cols], dtype=np.float64)
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            if dr == 0 and dc == 0:
                continue
            r = np.clip(rows + dr, 0, height - 1)
            c = np.clip(cols + dc, 0, width - 1)
            np.maximum(best, np.asarray(data[r, c], dtype=np.float64), out=best)

    return np.where(inside, best, 0.0)


def sample_structures(lats, lngs):
    """Roof elevation at each coordinate; 0 where nothing is built."""
    return _sample_nearest(structure_grid(), lats, lngs,
                           radius=STRUCTURE_SAMPLE_RADIUS_CELLS)


def classify(terrain_m, structure_m, bridge_m=None):
    """Surface code for each sample, from ground, building and bridge heights.

    Whichever is highest wins, so a bridge tower reads as bridge even where it
    stands over water.
    """
    codes = np.where(terrain_m <= WATER_MAX_M, SURFACE_WATER, SURFACE_LAND)
    codes = np.where(structure_m > terrain_m, SURFACE_STRUCTURE, codes)
    if bridge_m is None:
        return codes
    return np.where(bridge_m > np.maximum(terrain_m, structure_m),
                    SURFACE_BRIDGE, codes)
