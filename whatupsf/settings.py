import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# --- SECURITY ---
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key")  # replace in prod
DEBUG = os.environ.get("DJANGO_DEBUG", "False").lower() in ("1", "true", "yes")
DEBUG = True

ALLOWED_HOSTS = ["whatupsf.com", "www.whatupsf.com", "127.0.0.1", "localhost"]

# If you're on Django 4.0+, use full https URLs here. For 2.x, it’s ignored safely.
CSRF_TRUSTED_ORIGINS = [
    "https://whatupsf.com",
    "https://www.whatupsf.com",
]

# --- APPS / MIDDLEWARE unchanged ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'whatupsf',
    'bootstrap3_datetime',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]

ROOT_URLCONF = 'whatupsf.urls'
WSGI_APPLICATION = 'whatupsf.wsgi.application'

# --- DATABASE (MySQL strict mode + utf8mb4) ---
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'sfev',
        'USER': 'kramamurthi',
        'PASSWORD': 'dream2Win',          # move to env var in prod
        'HOST': 'mysql.whatupsf.com',
        'PORT': '3306',
        'OPTIONS': {
            # strict mode + sane defaults
            'init_command': (
                "SET sql_mode="
                "'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,"
                "ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', "
                "NAMES 'utf8mb4'"
            ),
            'charset': 'utf8mb4',
        },
    }
}

# --- I18N ---
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_L10N = True
USE_TZ = True

# --- STATIC / MEDIA ---
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'   # required for collectstatic
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
WHITENOISE_USE_FINDERS = True
# --- TEMPLATES (yours looked fine) ---
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],  # add template dirs if you have them
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

