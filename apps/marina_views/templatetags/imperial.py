"""Imperial display filters.

Elevations and distances are *stored* and computed in metres throughout, because
that is what the USGS DEM provides and converting on the way in would introduce
rounding into every downstream calculation. Conversion happens here, at the
last possible moment, purely for display.
"""

from django import template

register = template.Library()

M_TO_FT = 3.280839895
KM_TO_MI = 0.621371192


@register.filter
def feet(metres, places=0):
    """Metres to feet: ``{{ viewpoint.eye_elevation_m|feet }}``."""
    try:
        value = float(metres) * M_TO_FT
    except (TypeError, ValueError):
        return ''
    return '{:,.{}f}'.format(value, int(places))


@register.filter
def miles(kilometres, places=1):
    """Kilometres to miles: ``{{ line.distance_km|miles }}``."""
    try:
        value = float(kilometres) * KM_TO_MI
    except (TypeError, ValueError):
        return ''
    return '{:,.{}f}'.format(value, int(places))
