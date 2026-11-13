"""Django settings for the aquanest project.

Secrets and per-deployment values come from environment variables (or a local
.env file) via python-decouple. See .env.example for the expected variables.
Nothing here needs configuring to run locally — every setting has a
development-safe default.
"""

from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse

from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

# The default is dev-only and deliberately marked insecure: Django's own
# `manage.py check --deploy` flags it, so a deployment that forgets to set
# SECRET_KEY gets told rather than silently running on a public key.
SECRET_KEY = config("SECRET_KEY", default="django-insecure-dev-only-change-me")
# Defaults to False so a deployment has to opt *in* to debug, not out of it.
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Local apps
    "dashboard",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves collected static files straight from the WSGI process, so no
    # nginx/S3 static config is needed. Must sit right after SecurityMiddleware.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Every page needs a signed-in user; views opt out with @login_not_required
    # (the login, sign-up and admin login pages already do).
    "django.contrib.auth.middleware.LoginRequiredMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "aquanest.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "aquanest.wsgi.application"


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases
#
# Production uses Neon Postgres: the Vercel Neon integration sets DATABASE_URL
# (the pooled connection string). Without it - local development - SQLite.

DATABASE_URL = config("DATABASE_URL", default="")
if DATABASE_URL:
    _db = urlparse(DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db.path.lstrip("/"),
            "USER": unquote(_db.username or ""),
            "PASSWORD": unquote(_db.password or ""),
            "HOST": _db.hostname,
            "PORT": _db.port or 5432,
            # sslmode / channel_binding from the URL go straight to libpq.
            "OPTIONS": dict(parse_qsl(_db.query)),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "dashboard:ponds"
LOGOUT_REDIRECT_URL = "login"


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = "en-us"

# Display timezone. The farms are on the Karnataka coast, so UTC would render
# every timestamp — and the time-of-day greeting — five and a half hours off.
# Storage stays UTC regardless (USE_TZ=True).
TIME_ZONE = config("TIME_ZONE", default="Asia/Kolkata")

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# WhiteNoise: compress static files at collectstatic time for far-future
# caching. No manifest, so a stray {% static %} to a missing file won't break
# the build (the manifest variant would) — and {% static_v %} already does the
# cache-busting during development.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --- Production hardening ---------------------------------------------------
# Origins allowed to POST once the app is behind a domain over HTTPS,
# e.g. CSRF_TRUSTED_ORIGINS=https://aqua.example.com
CSRF_TRUSTED_ORIGINS = config("CSRF_TRUSTED_ORIGINS", default="", cast=Csv())

# Flip on once TLS terminates in front of the app. Leaving it False keeps a
# plain-HTTP / IP-only box working — turning it on without HTTPS locks you out
# via a redirect loop.
SECURE_SSL = config("SECURE_SSL", default=False, cast=bool)
if SECURE_SSL:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True


# Everything goes to the console on purpose: under systemd/gunicorn/Docker
# that is what the platform captures (journalctl, docker logs). Writing our own
# files would mean owning rotation and disk limits for no benefit.
#
# django.request stays wired so a 500's traceback is never lost, while plain
# `django` sits at WARNING because its INFO level logs a line per request —
# that is the proxy's job, not the app's.
LOG_LEVEL = config("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "{asctime} {levelname:<8} {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "dashboard": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
    },
}
