from django import forms

from .models import TShirtRegistration

class TShirtRegistrationForm(forms.ModelForm):
    class Meta:
        model = TShirtRegistration
