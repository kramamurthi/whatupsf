from django.http import HttpResponse
from django.shortcuts import render
from django.conf import settings
from firebase import firebase
from datetime import date, datetime
from zoneinfo import ZoneInfo
import json

# Outside Lands 2026. The single source of truth for the festival window — the map
# reads it via window.MAP_CONFIG.oslActive rather than re-deriving the date in JS.
# Evaluated in SF time so it does not expire early for visitors in other zones.
OSL_START = date(2026, 8, 7)
OSL_END = date(2026, 8, 9)


def osl_active():
	"""True while Outside Lands is running, by San Francisco local date."""
	today = datetime.now(ZoneInfo('America/Los_Angeles')).date()
	return OSL_START <= today <= OSL_END


def default(request):
	context = {
	'name':'SFEventMapper',
	'use_convex_hull': getattr(settings, 'USE_CONVEX_HULL', True),
	'osl_active': osl_active(),
	}
	return render(request,"whatupsf/index.html", context)


def render_json(request):
    # Load venue data from etl directory (67 SF venues)
    data_path = settings.BASE_DIR / 'etl' / 'publish.json'
    with open(data_path, 'r') as f:
        json_data = json.load(f)

    json_str = json.dumps(json_data)
    return HttpResponse(json_str, content_type="application/json")

def render_map(request):
	context = {
	'name':'San Francisco Night Life',
	}
	return render(request,"index.html", context)




