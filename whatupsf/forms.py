from django import forms
from models import EventInformation
from models import BandInformation

class EventInformationForm(forms.ModelForm):
    class Meta:
        model = EventInformation

class BandInformationForm(forms.ModelForm):
    class Meta:
        model = BandInformation
