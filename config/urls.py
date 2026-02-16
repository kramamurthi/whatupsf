from django.conf.urls import include, url
from django.views.generic import TemplateView
from django.contrib import admin
from django.http import HttpResponse
from django.urls import path


from config.views import map_view, form_view, test_view

def health(_): return HttpResponse("ok")
urlpatterns = [
    url(r'^admin/', admin.site.urls),
    url(r'^$', map_view.default, name='default_view'),
    url(r'^test-modern/', TemplateView.as_view(template_name='test_modern.html'), name='test_modern'),
    url(r'^mapper/', map_view.render_map, name='Event Map'),
    url(r'^json/', map_view.render_json, name='Event Data'),
    url(r'^event/', form_view.event_information),
    url(r'^band/', form_view.band_information),
    url(r'^venue/', form_view.venue_information),
    url(r'^dates/', form_view.date_form),
    url(r'^test/', test_view.test),
]
urlpatterns += [path("health/", health)]
urlpatterns += [path("api/map-data.json", map_view.render_json, name="map_data")]
