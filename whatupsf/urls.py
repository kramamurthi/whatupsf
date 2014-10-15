from django.conf.urls import patterns, include, url
from django.views.generic import TemplateView
import sys
from django.contrib import admin
#admin.autodiscover()

from whatupsf.views import map_view, views #event_form
urlpatterns = patterns('',
    # Examples:
    # url(r'^$', 'whatupsf.views.home', name='home'),
    # url(r'^blog/', include('blog.urls')),

    url(r'^admin/', include(admin.site.urls)),
    url(r'^$', map_view.default, name='default_view'),
    url(r'^mapper/', map_view.render_map, name='Event Map'),
    url(r'^json/', map_view.render_json, name='Event Data'),
    #url(r'^save/', event_form.save_event, name='Save Event'),
    #url(r'^form/', views.tshirt_register),
    url(r'^event/', views.event_information),
)