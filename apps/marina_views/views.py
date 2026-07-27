"""HTTP layer for Marina Views.

These views stay deliberately thin: parse input, hand it to a domain module,
render or serialise the result. Logic about what can be seen belongs in
`visibility.py`; logic about the ground belongs in `terrain.py`.
"""

from django.core.cache import cache
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from . import panorama, terrain, visibility
from .models import Viewpoint

#: A ray cast takes a second or so, and nudging the camera by a metre cannot
#: change the skyline, so results are shared across nearby requests.
PANORAMA_CACHE_SECONDS = 60 * 60


def picker(request):
    """Landing page: pick a point on the map and choose a camera altitude."""
    return render(request, 'marina_views/picker.html')


def frustum(request):
    """Full-page rendered view from a camera position given in the query."""
    return render(request, 'marina_views/frustum.html')


def api_panorama(request):
    """360 degree horizon profile for a camera at a position and altitude."""
    try:
        lat = float(request.GET['lat'])
        lng = float(request.GET['lng'])
        alt = float(request.GET['alt'])
    except (KeyError, TypeError, ValueError):
        return JsonResponse(
            {'error': 'lat, lng and alt query parameters are required'},
            status=400)

    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return JsonResponse({'error': 'coordinate out of range'}, status=400)
    if not (-500.0 <= alt <= 10000.0):
        return JsonResponse({'error': 'altitude out of range'}, status=400)

    # Round to about a metre horizontally before caching.
    key = 'marina:panorama:{:.5f}:{:.5f}:{:.1f}'.format(lat, lng, alt)
    payload = cache.get(key)
    if payload is None:
        payload = panorama.terrain_profile(lat, lng, alt)
        cache.set(key, payload, PANORAMA_CACHE_SECONDS)

    return JsonResponse(payload)


def api_elevation(request):
    """Ground elevation at a WGS84 coordinate, in metres above sea level."""
    try:
        lat = float(request.GET['lat'])
        lng = float(request.GET['lng'])
    except (KeyError, TypeError, ValueError):
        return JsonResponse(
            {'error': 'lat and lng query parameters are required'}, status=400)

    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return JsonResponse({'error': 'coordinate out of range'}, status=400)

    try:
        elevation = terrain.elevation_at(lat, lng)
    except terrain.ElevationUnavailable:
        # A real distinction: we have no data here, as opposed to the ground
        # genuinely being at sea level. The exception text names a server path,
        # so report a generic message rather than echoing it to the client.
        return JsonResponse(
            {'error': 'no elevation data covers this location'}, status=404)

    return JsonResponse({
        'lat': lat,
        'lng': lng,
        'elevation_m': round(elevation, 1),
    })


def viewpoint_list(request):
    viewpoints = Viewpoint.objects.filter(is_active=True)
    return render(request, 'marina_views/viewpoint_list.html', {
        'viewpoints': viewpoints,
    })


def viewpoint_detail(request, slug):
    viewpoint = get_object_or_404(Viewpoint, slug=slug, is_active=True)
    lines = visibility.sight_lines(viewpoint)

    # Split here rather than in the template: the template should present a
    # decision, not make one.
    return render(request, 'marina_views/viewpoint_detail.html', {
        'viewpoint': viewpoint,
        'visible_lines': [line for line in lines if line.is_visible],
        'blocked_lines': [line for line in lines if not line.is_visible],
        'total_count': len(lines),
    })
