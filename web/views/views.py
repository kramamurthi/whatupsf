from django.shortcuts import render

from .forms import TShirtRegistrationForm

def tshirt_register(request):
    if request.method == 'POST':
        form = TShirtRegistrationForm(request.POST)

        if form.is_valid():

            form.save()

            return render(request, "tshirt_register/success.html")

    else:
        form = TShirtRegistrationForm()


    return render(request, "tshirt_register/tshirt_register.html", { 'form' : form })
