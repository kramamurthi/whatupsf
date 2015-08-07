from django.shortcuts import render
from whatupsf.forms import EventInformationForm
from whatupsf.forms import BandInformationForm

def event_information(request):
    if request.method == 'POST':
        form = EventInformationForm(request.POST)
        if form.is_valid():
            form.save()
            return render(request, "forms/success.html")
    else:
        form = EventInformationForm()

    return render(request, "forms/information.html", { 'form' : form })

def band_information(request):
    if request.method == 'POST':
        form = BandInformationForm(request.POST)
        if form.is_valid():
            form.save()
            return render(request, "forms/success.html")
    else:
        form = BandInformationForm()

    return render(request, "forms/information.html", { 'form' : form })
