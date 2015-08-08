from bootstrap3_datetime.widgets import DateTimePicker
from django import forms
from models import Events
from models import Bands
from models import Venues

class EventInformationForm(forms.ModelForm):
    class Meta:
        model = Events

class BandInformationForm(forms.ModelForm):
    class Meta:
        model = Bands

#class BandForm(forms.Form):
#    pass
       #series = ModelChoiceField(queryset=bands.objects.all()) # Or whatever query you'd like

class VenueInformationForm(forms.ModelForm):
    class Meta:
        model = Venues

class ToDoForm(forms.Form):

    todo = forms.CharField(
        widget=forms.TextInput(attrs={"class": "form-control"}))
    date = forms.DateField(
        widget=DateTimePicker(options={"format": "YYYY-MM-DD",
                                       "pickTime": False}))
    reminder = forms.DateTimeField(
        required=False,
        widget=DateTimePicker(options={"format": "YYYY-MM-DD HH:mm",
                                       "pickSeconds": False}))

