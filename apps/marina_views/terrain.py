"""Ground elevation lookups against the USGS 3DEP digital elevation model.

This is the only module in the application that knows the DEM exists. Everything
upstream asks for "the elevation at this latitude and longitude" and stays
ignorant of tiles, file formats, datums and nodata conventions.

About the data
--------------
USGS 3DEP 1/3 arc-second (~10m) GeoTIFFs, one per 1x1 degree cell, named after
the cell's *north-west* corner: ``USGS_13_n38w123.tif`` spans latitude 37..38
and longitude -123..-122. Values are metres above the NAVD88 vertical datum;
the horizontal datum is NAD83, which differs from the WGS84 coordinates a web
map produces by well under one pixel in California — we transform anyway rather
than rely on that.

Ocean and other areas outside coverage carry a large negative nodata value,
which we report as sea level.
"""

import math
import os
import threading

import rasterio
from django.conf import settings
from pyproj import Transformer

#: Web maps hand us WGS84; the DEM is NAD83.
WGS84 = 'EPSG:4326'

#: Elevation reported where the DEM has no data (open ocean, outside coverage).
SEA_LEVEL_M = 0.0

# Opening a GeoTIFF is not free, so keep readers around. The lock matters
# because gunicorn may eventually run threaded workers; today it is sync.
_readers = {}
_transformers = {}
_lock = threading.Lock()


class ElevationUnavailable(Exception):
    """Raised when no DEM tile covers the requested coordinate."""


def tile_name(lat, lng):
    """Name of the 3DEP cell containing a coordinate, e.g. ``n38w123``.

    Tiles are labelled by their north-west corner, so the latitude rounds *up*
    and the longitude rounds away from zero.
    """
    north = math.ceil(lat)
    west = abs(math.floor(lng))
    return 'n{:02d}w{:03d}'.format(north, west)


def tile_path(lat, lng):
    return os.path.join(str(settings.MARINA_DEM_DIR),
                        'USGS_13_{}.tif'.format(tile_name(lat, lng)))


def _reader(path):
    """Return a cached rasterio reader for `path`, opening it on first use."""
    with _lock:
        reader = _readers.get(path)
        if reader is None:
            if not os.path.exists(path):
                raise ElevationUnavailable(
                    'No DEM tile at {}'.format(path))
            reader = rasterio.open(path)
            _readers[path] = reader
        return reader


def _to_dataset_crs(reader, lat, lng):
    """Convert WGS84 lat/lng into the dataset's own coordinate system."""
    crs = reader.crs.to_string()
    if crs == WGS84:
        return lng, lat

    with _lock:
        transformer = _transformers.get(crs)
        if transformer is None:
            # always_xy keeps the argument order as (longitude, latitude)
            # regardless of what the CRS declares its axis order to be.
            transformer = Transformer.from_crs(WGS84, crs, always_xy=True)
            _transformers[crs] = transformer
    return transformer.transform(lng, lat)


def elevation_at(lat, lng):
    """Ground elevation in metres above sea level at a WGS84 coordinate.

    Returns `SEA_LEVEL_M` where the DEM records nodata, which over the bay and
    the open ocean is the honest answer. Raises `ElevationUnavailable` if no
    tile covers the point at all — a different situation, and one the caller
    should be able to distinguish.
    """
    reader = _reader(tile_path(lat, lng))
    x, y = _to_dataset_crs(reader, lat, lng)

    row, col = reader.index(x, y)
    if not (0 <= row < reader.height and 0 <= col < reader.width):
        raise ElevationUnavailable(
            'Coordinate {}, {} falls outside {}'.format(lat, lng, reader.name))

    # Read the single pixel rather than any larger block: this is called once
    # per user click, and a 1x1 window keeps it cheap on a 477MB file.
    window = rasterio.windows.Window(col, row, 1, 1)
    value = float(reader.read(1, window=window)[0][0])

    nodata = reader.nodata
    if nodata is not None and math.isclose(value, nodata, rel_tol=1e-9):
        return SEA_LEVEL_M
    if value < -1000.0:  # belt and braces for tiles with nodata undeclared
        return SEA_LEVEL_M
    return value
