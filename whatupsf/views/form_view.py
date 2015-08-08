from django.shortcuts import render
from whatupsf.forms import EventInformationForm
from whatupsf.forms import BandInformationForm
from whatupsf.forms import VenueInformationForm
from whatupsf.forms import ToDoForm
from whatupsf.models import Bands


def band_information(request):
    if request.method == 'POST':
        form = BandInformationForm(request.POST)
        if form.is_valid():
            form.save()
            return render(request, "forms/success.html")
    else:
        form = BandInformationForm()

    return render(request, "forms/information.html", { 'form' : form })

def venue_information(request):
    if request.method == 'POST':
        form = VenueInformationForm(request.POST)
        if form.is_valid():
            form.save()
            return render(request, "forms/success.html")
    else:
        form = VenueInformationForm()

    return render(request, "forms/information.html", { 'form' : form })

def event_information(request):

    if request.method == 'POST':
        eventForm = EventInformationForm(request.POST)
        if eventForm.is_valid():
            eventForm.save()
            return render(request, "forms/success.html")
    else:
        eventForm = EventInformationForm()

    return render(request, "forms/information.html", { 'form' : eventForm })

def date_form(request):
    if request.method == 'POST':
        form = ToDoForm(request.POST)
        if form.is_valid():
            form.save()
            return render(request, "forms/template.html")
    else:
        form = ToDoForm()

    return render(request, "forms/template.html", { 'form' : form })
