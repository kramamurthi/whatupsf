"""Line-of-sight angle maths for a camera standing on the earth.

Kept separate from `geometry.py` because that module answers "where is it?"
(distance, bearing) while this one answers "how far above or below my eye line
does it appear?" — which needs the earth to curve away underneath.

Every function here accepts NumPy arrays as readily as scalars, so the ray
caster can evaluate a million samples in one call without a second
implementation drifting out of step with this one.

The pixel projection deliberately lives in the browser (`frustum.js`) rather
than here: the user pans continuously, so projection has to happen per frame
on the client. The server's job is to supply angles, which is what this does.
"""

import numpy as np

#: Mean earth radius (IUGG), metres.
EARTH_RADIUS_M = 6371008.8

#: Standard atmospheric refraction bends light downward, letting an observer
#: see slightly beyond the geometric horizon. Modelling it as a 7/6 larger
#: earth is the usual surveying approximation.
REFRACTION_FACTOR = 7.0 / 6.0

EFFECTIVE_RADIUS_M = EARTH_RADIUS_M * REFRACTION_FACTOR


def curvature_drop_m(distance_m):
    """How far the earth's surface falls away over `distance_m`.

    Includes refraction, so this is the *apparent* drop, which is what a
    camera actually sees.
    """
    return np.square(distance_m) / (2.0 * EFFECTIVE_RADIUS_M)


def elevation_angle_deg(distance_m, target_elevation_m, camera_elevation_m):
    """Angle above (+) or below (-) the horizontal at which a point appears.

    `distance_m` is horizontal ground distance; elevations are metres above
    mean sea level. A distant target must out-climb the curvature drop before
    it rises above the eye line at all.
    """
    rise = (np.asarray(target_elevation_m, dtype=np.float64)
            - camera_elevation_m
            - curvature_drop_m(distance_m))
    return np.degrees(np.arctan2(rise, distance_m))


def horizon_dip_deg(camera_elevation_m):
    """Angle below horizontal of the sea horizon for a camera at this height.

    Useful as a sanity bound: no water surface can appear above this line.
    """
    height = np.maximum(np.asarray(camera_elevation_m, dtype=np.float64), 0.0)
    return -np.degrees(np.arccos(
        EFFECTIVE_RADIUS_M / (EFFECTIVE_RADIUS_M + height)))
