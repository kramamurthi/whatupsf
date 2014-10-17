from django import forms
from models import EventInformation

class EventInformationForm(forms.ModelForm):
    class Meta:
        model = EventInformation
