from django.urls import path

from . import views

app_name = 'marina_views'

urlpatterns = [
    path('', views.picker, name='picker'),
    path('api/elevation/', views.api_elevation, name='api_elevation'),
    path('viewpoints/', views.viewpoint_list, name='viewpoint_list'),
    path('viewpoints/<slug:slug>/', views.viewpoint_detail, name='viewpoint_detail'),
]
