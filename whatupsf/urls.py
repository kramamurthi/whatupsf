from django.conf.urls import patterns, include, url
from django.views.generic import TemplateView

from django.contrib import admin
admin.autodiscover()

from whatupsf import views
urlpatterns = patterns('',
    # Examples:
    # url(r'^$', 'whatupsf.views.home', name='home'),
    # url(r'^blog/', include('blog.urls')),

    url(r'^admin/', include(admin.site.urls)),
    url(r'^$', views.default, name='default_view'),
    url(r'^mapper/', views.render_map, name='Event Map'),
    url(r'^json/', views.render_json, name='Event Data'),

)
