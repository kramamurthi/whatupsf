from django.shortcuts import render

from whatupsf.forms import EventInformationForm
#TShirtRegistrationForm
#def tshirt_register(request):
#    if request.method == 'POST':
#        form = TShirtRegistrationForm(request.POST)
#        if form.is_valid():
#            form.save()
#            return render(request, "tshirt_register/success.html")
#    else:
#        form = TShirtRegistrationForm()

#    return render(request, "tshirt_register/tshirt_register.html", { 'form' : form })

def event_information(request):
    if request.method == 'POST':
        form = EventInformationForm(request.POST)
        if form.is_valid():
            form.save()
            return render(request, "event_information/success.html")
    else:
        form = EventInformationForm()

    return render(request, "event_information/event_information.html", { 'form' : form })
