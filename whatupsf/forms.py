from django import forms
from models import EventInformation
from models import BandInformation
from models import VenueInformation

class EventInformationForm(forms.ModelForm):
    class Meta:
        model = EventInformation

class BandInformationForm(forms.ModelForm):
    class Meta:
        model = BandInformation

class VenueInformationForm(forms.ModelForm):
    class Meta:
        model = VenueInformation
