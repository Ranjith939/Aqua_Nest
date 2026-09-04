# AQUA NEST

Django dashboard for aquaculture pond monitoring — a UI-only stage with a
3D digital twin (Three.js). Every reading is demo data declared in Python;
there are no models, APIs or sensor integrations yet.

## Requirements

- Python 3.11+ (developed on 3.13)
- Django 5.2 (`requirements.txt`)

## Run

```bash
pip install -r requirements.txt
python manage.py runserver 9003
```

Open <http://127.0.0.1:9003/>.

No `migrate` needed — the app defines no models. Run it only if you want the
Django admin at `/admin/` (it needs the auth/session tables in `db.sqlite3`):

```bash
python manage.py migrate
python manage.py createsuperuser
```

## Routes

| Path             | View                                            |
| ---------------- | ----------------------------------------------- |
| `/`              | Ponds — home, digital twin + telemetry panels    |
| `/intelligence/` | Placeholder                                      |
| `/control/`      | Placeholder                                      |
| `/nest/`         | Placeholder                                      |
| `/life/`         | Placeholder                                      |
| `/overview/`     | Parked farm-wide dashboard (not in the sidebar)  |
| `/admin/`        | Django admin                                     |

## Layout

```
aquanest/            project settings, root urls
dashboard/
  views.py           dummy data + page views (get_*() are the template contract)
  pond_state.py      readings -> pond state engine feeding the digital twin
  templatetags/      {% static_v %} — mtime cache-busting for static assets
  templates/         page + partial templates
  static/dashboard/  css, js, vendored three.js, .glb models
templates/           base layout and shared partials
```

## Notes

- `DEBUG = True` and the checked-in `SECRET_KEY` are development-only. Set both
  from the environment and fill `ALLOWED_HOSTS` before deploying.
- Three.js and its loaders are vendored under `static/dashboard/vendor/` — no
  npm, no build step.
