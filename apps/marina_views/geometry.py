"""Spherical geometry helpers for line-of-sight calculations.

This module deliberately imports nothing from Django. Everything here is a
plain function over floats, which means it can be reasoned about and tested
without a settings module or a test database.

Conventions used throughout:
  * latitude / longitude are decimal degrees, north and east positive
  * distances are kilometres
  * heights are metres above mean sea level
  * bearings are degrees clockwise from true north, in [0, 360)
"""

from math import asin, atan2, cos, degrees, radians, sin, sqrt

# Mean earth radius (IUGG). Good to ~0.5% for the Bay Area distances we care
# about, which is far below the accuracy of our elevation data anyway.
EARTH_RADIUS_KM = 6371.0088

# Geometric horizon coefficient: d_km = 3.57 * sqrt(h_metres). This ignores
# atmospheric refraction, which would extend the horizon by roughly 8%
# (coefficient 3.86). We take the conservative figure so that "visible" does
# not over-promise.
HORIZON_COEFFICIENT = 3.57

COMPASS_POINTS = (
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
)


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance between two points, in kilometres."""
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = radians(lon2 - lon1)

    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def initial_bearing_deg(lat1, lon1, lat2, lon2):
    """Compass bearing from point 1 to point 2, degrees clockwise from north.

    This is the *initial* bearing of the great-circle path. Over Bay-sized
    distances it is indistinguishable from the constant heading.
    """
    phi1, phi2 = radians(lat1), radians(lat2)
    d_lambda = radians(lon2 - lon1)

    y = sin(d_lambda) * cos(phi2)
    x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(d_lambda)
    return (degrees(atan2(y, x)) + 360.0) % 360.0


def compass_point(bearing_deg):
    """Nearest 16-point compass label for a bearing, e.g. 293.0 -> 'WNW'."""
    index = int((bearing_deg % 360.0) / 22.5 + 0.5) % 16
    return COMPASS_POINTS[index]


def horizon_distance_km(height_m):
    """Distance to the horizon for an observer at `height_m` above sea level."""
    return HORIZON_COEFFICIENT * sqrt(max(height_m, 0.0))


def max_sight_distance_km(observer_height_m, target_height_m):
    """Furthest separation at which two points can still see each other.

    Each point can see to its own horizon; they remain mutually visible as
    long as their horizons overlap, so the limits simply add.
    """
    return (horizon_distance_km(observer_height_m)
            + horizon_distance_km(target_height_m))


def angular_difference_deg(bearing_a, bearing_b):
    """Smallest absolute angle between two bearings, in [0, 180]."""
    delta = abs((bearing_a - bearing_b) % 360.0)
    return min(delta, 360.0 - delta)


def is_within_arc(bearing_deg, facing_deg, field_of_view_deg):
    """True if `bearing_deg` falls inside a view arc centred on `facing_deg`.

    A field of view of 360 means "unobstructed in every direction" and always
    matches, which avoids a degenerate half-open arc at exactly 180 either side.
    """
    if field_of_view_deg >= 360.0:
        return True
    return angular_difference_deg(bearing_deg, facing_deg) <= field_of_view_deg / 2.0
