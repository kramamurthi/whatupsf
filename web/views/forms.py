from django import forms

from .models import TShirtRegistration, EventInformation

class TShirtRegistrationForm(forms.ModelForm):
    class Meta:
        model = TShirtRegistration

class EventInformationForm(forms.ModelForm):
    class Meta:
        model = EventInformation
