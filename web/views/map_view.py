from django.http import HttpResponse
from django.shortcuts import render
import json

def default(request):
	context = {
	'name':'SFEventMapper',
	}
	return render(request,"default.html", context)


def render_json(request):
#	json_data = [{u'lat': 37.760792, u'url': u'http://www.amnesiathebar.com', u'lng': -122.421212, u'venue': u'Amnesia Bar', u'events': [{u'eventName': u'Snowapple', u'eventTime': u'7pm', u'eventUrl': u'https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/81900842&amp;visual=true', u'eventPrice': u'$5'}, {u'eventName': u'Hella Tight', u'eventTime': u'10pm', u'eventUrl': u'http://player.vimeo.com/video/16101483', u'eventPrice': u'$5'}]}, {u'lat': 37.764031, u'url': u'http://elbo.com', u'lng': -122.421513, u'venue': u'Elbo Room', u'events': [{u'eventName': u'Soul Party', u'eventTime': u'10pm', u'eventUrl': u'http://player.vimeo.com/video/20307099?title=0&byline=0&potrait=0', u'eventPrice': u'$10'}]}]	

	json_data = json.load(open('/home/kriram5/whatupSF.com/whatupsf/web/static/event.json','r'))
	json_str = json.dumps(json_data)
	return HttpResponse(json_str, content_type="application/json")

def render_map(request):
	context = {
	'name':'San Francisco Night Life',
	}
	return render(request,"index.html", context)




