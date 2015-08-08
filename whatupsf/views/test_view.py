from django.shortcuts import render
from whatupsf.models import Bands
from whatupsf.models import Events
from whatupsf.models import Venues
import json


def test(request):
    jData = []
    for venue in Venues.objects.all():
        eData = []
        jDict = {"lat": venue.latitude, 
                 "lng": venue.longitude, 
                 "url": venue.url,
                 "events": eData, 
                 "venue": venue.name}
        b = Events.objects.filter(venue__id=venue.id)
        for event in b:
            eDict = {}
            print(venue.name)
            print(event.id)
            eDict['eventName'] = event.band.name
            eDict['eventPrice'] = '$'+str(event.price)
            eDict['eventUrl'] = event.band.media_url
            eDict['eventTime'] = str(event.time.strftime('%l:%M %p'))
            eData.append(eDict)
                                                                    
        jData.append(jDict)
    
    jString = json.dumps(jData, sort_keys = False, indent=4)
    fH = open('ol.json','w')
    fH.write(jString)
    fH.close()

    return render(request, "forms/success.html")
    
