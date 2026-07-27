from django.contrib import admin

from .models import Landmark, Viewpoint


@admin.register(Landmark)
class LandmarkAdmin(admin.ModelAdmin):
    list_display = ('name', 'height_m', 'latitude', 'longitude', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name',)
    prepopulated_fields = {'slug': ('name',)}


@admin.register(Viewpoint)
class ViewpointAdmin(admin.ModelAdmin):
    list_display = ('name', 'eye_elevation_m', 'facing_bearing_deg',
                    'field_of_view_deg', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name',)
    prepopulated_fields = {'slug': ('name',)}
