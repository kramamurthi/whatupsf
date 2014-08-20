# Import the Django models ORM library                                                                                
from django.db import models
from django import forms
# Create a model class to store the data for                                                                          
# T-Shirt registration. Various types of fields                                                                       
# are available in the models package.                                                                                
class TShirtRegistration(models.Model):                                                                               
    name = models.CharField(max_length=100)                                                                             
    email = models.EmailField()                                                                                         
    tshirt_sizes = (('S', 'Small'),                                                                                     
    ('M', 'Medium'),                                                                                    
    ('L', 'Large'),                                                                                     
    ('XL', 'Extra Large'))                                                                              
# Limit the choices for the size field to the above given choices                                                   
    size = models.CharField(max_length=2, choices=tshirt_sizes)                                                         
    address = models.TextField()          

class EventInformation(models.Model):
    eventName = models.CharField(max_length=100)
    eventPrice = models.DecimalField(max_digits=4, decimal_places=2)
    eventTime = forms.TimeField(widget=forms.TimeInput(format='%H:%M'))
    eventTime2 =models.TimeField()
    eventUrl = models.URLField(max_length=200)