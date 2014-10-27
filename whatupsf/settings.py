"""
Django settings for whatupsf project.

For more information on this file, see
https://docs.djangoproject.com/en/1.6/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/1.6/ref/settings/
"""

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
import os
import dj_database_url
from django.utils.crypto import get_random_string

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/1.6/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get("SECRET_KEY", get_random_string(50, "abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*(-_=+)"))

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

TEMPLATE_DEBUG = True
EMAIL_SUBJECT_PREFIX = 'WhatupSF Error:'
SERVER_EMAIL='whatupsf-error@do_not_reply.com'
# Allow all host headers
ALLOWED_HOSTS = ['*']

# Application definition

INSTALLED_APPS = (
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'whatupsf',
)

MIDDLEWARE_CLASSES = (
    'sslify.middleware.SSLifyMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
)

ROOT_URLCONF = 'whatupsf.urls'

TEMPLATE_DIRS = (
	os.path.join(os.path.abspath(os.path.dirname(__file__)), 'templates')
,)

WSGI_APPLICATION = 'whatupsf.wsgi.application'

# Honor the 'X-Forwarded-Proto' header for request.is_secure()
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')


DATABASES = {
    'default': dj_database_url.config(default='postgres://localhost'),
    'development': {
    	'ENGINE': 'django.db.backends.mysql',
    	'NAME': 'whatup',
    	'USER': 'admin',
    	'PASSWORD': 'pass',
    	'HOST': '127.0.0.1',
    	'PORT': '3306',
    }
}

# Email settings.
EMAIL_HOST = "smtp.sendgrid.net"
EMAIL_HOST_USER = os.environ.get("SENDGRID_USERNAME", "")
EMAIL_HOST_PASSWORD = os.environ.get("SENDGRID_PASSWORD", "")
EMAIL_PORT = 25
EMAIL_USE_TLS = False

# Internationalization
# https://docs.djangoproject.com/en/1.6/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_L10N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/1.6/howto/static-files/
STATIC_ROOT = 'staticfiles'
STATIC_URL = '/static/'
STATICFILES_DIRS = (
    os.path.join(BASE_DIR, 'static'),
)
