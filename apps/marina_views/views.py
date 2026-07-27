"""HTTP layer for Marina Views.

These views stay deliberately thin: parse input, hand it to a domain module,
render or serialise the result. Logic about what can be seen belongs in
`visibility.py`; logic about the ground belongs in `terrain.py`.
"""

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from . import terrain, visibility
from .models import Viewpoint


def picker(request):
    """Landing page: pick a point on the map and choose a camera altitude."""
    return render(request, 'marina_views/picker.html')


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
