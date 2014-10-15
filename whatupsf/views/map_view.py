from django.http import HttpResponse
from django.shortcuts import render
from firebase import firebase
import json

def default(request):
	context = {
	'name':'SFEventMapper',
	}
	return render(request,"default.html", context)


def render_json(request):

    #old method
	#json_data = json.load(open('/home/kriram5/whatupSF.com/whatupsf/web/static/event.json','r'))
    fire = firebase.FirebaseApplication('https://popping-fire-3129.firebaseio.com/')
    json_data = fire.get('', None)
    json_str = json.dumps(json_data)
    return HttpResponse(json_str, content_type="application/json")

def render_map(request):
	context = {
	'name':'San Francisco Night Life',
	}
	return render(request,"index.html", context)




