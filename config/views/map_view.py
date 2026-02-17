from django.http import HttpResponse
from django.shortcuts import render
from django.conf import settings
from firebase import firebase
import json

def default(request):
	context = {
	'name':'SFEventMapper',
	'use_convex_hull': getattr(settings, 'USE_CONVEX_HULL', False),
	}
	return render(request,"whatupsf/index.html", context)


def render_json(request):
    # Load venue data from etl directory (67 SF venues)
    data_path = settings.BASE_DIR / 'etl' / 'new_events.json'
    with open(data_path, 'r') as f:
        json_data = json.load(f)

    json_str = json.dumps(json_data)
    return HttpResponse(json_str, content_type="application/json")

def render_map(request):
	context = {
	'name':'San Francisco Night Life',
	}
	return render(request,"index.html", context)




