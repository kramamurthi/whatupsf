from django.http import HttpResponse
from django.shortcuts import render
from firebase import firebase
import json

def default(request):
	context = {
	'name':'SFEventMapper',
	}
	return render(request,"whatupsf/index.html", context)


def render_json(request):

    #old method
    with open('/home/kriram5/whatupsf.com/static/od-sat.json', 'r') as f:
        json_data = json.load(f)
	#json_data = json.load(open('/home/kriram5/whatupsf.com/static','r'))
    #fire = firebase.FirebaseApplication('https://popping-fire-3129.firebaseio.com/')
    #json_data = fire.get('', None)
    json_str = json.dumps(json_data)
    return HttpResponse(json_str, content_type="application/json")

def render_map(request):
	context = {
	'name':'San Francisco Night Life',
	}
	return render(request,"index.html", context)




