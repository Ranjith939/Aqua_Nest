# AQUA NEST

Django dashboard for aquaculture pond monitoring — a UI-only stage with a
3D digital twin (Three.js). Every reading is demo data declared in Python;
there are no models, APIs or sensor integrations yet.

## Requirements

- Python 3.11+ (developed on 3.13)
- Django 5.2, python-decouple, whitenoise (`requirements.txt`)

## Run

```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1   
pip install -r requirements.txt
python manage.py runserver 9003
```

Open <http://127.0.0.1:9003/>.

Runs with no configuration: every setting has a development default.
For local work with the debug pages, drop a one-line `.env` next to
`manage.py` containing `DEBUG=True` — it is gitignored.

## Tests

```bash
python manage.py test
```

Covers the pond state engine (band edges, health scoring, the demo-data
tables staying in step with each other) and a smoke test that every route
in the sidebar renders.

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
| `/control/`      | Control — on/off switches for the pond equipment  |
| `/nest/`         | Placeholder                                      |
| `/life/`         | Placeholder                                      |
| `/overview/`     | Parked farm-wide dashboard (not in the sidebar)  |
| `/admin/`        | Django admin                                     |

## Connecting real equipment

Switching a device today changes a dictionary in `pond_state.py` and nothing
else — the page says "Not wired to hardware" for that reason. Here is the whole
path from the button to a running motor, and the one function you replace.

### The chain

```
browser  --POST /control/-->  Django  --HTTP-->  ESP32  -->  relay
                                                              |
                                              light (direct)  |  contactor --> pump / aerator motor
```

Django never touches a pin. It sends one command to the controller at the pond
and the controller owns the electricity — so a web request that times out, or a
server that is rebooting, cannot leave a pump in an unknown state.

### Electrically

- **A pond light** (LED / low-wattage) can sit directly on a relay channel,
  inside the relay's rating.
- **A motor pump or paddlewheel aerator cannot.** A 0.5–2 HP motor draws far
  more than a hobby relay module can switch, and its start-up surge is several
  times its running current. The relay switches a **contactor coil**; the
  contactor switches the motor. Fuse or breaker each motor line, and keep the
  230 V side physically separated from the ESP32's 3.3 V side.
- Give the ESP32 its own supply, not one tapped off the motor circuit — motor
  start-up drops the rail and browns out the microcontroller mid-command.
- **Interlocks belong in the firmware, not only here.** The one in this app
  (aerator cannot be switched off while a pond is oxygen-critical) protects the
  operator from a mistaken click. It does not protect the fish from the Wi-Fi
  dying, and the app cannot: only the controller is still running then.

### In this codebase

One function is the seam: `pond_state.set_device()`. It is already the only
place a device state changes, so the page, the interlock and the tests do not
move. Replace its body:

```python
import requests   # add to requirements.txt

CONTROLLERS = {1: "http://192.168.1.51", 2: "http://192.168.1.52"}  # per pond

def set_device(pond_id, key, on):
    ...
    response = requests.post(
        f"{CONTROLLERS[pond_id]}/device",
        json={"device": key, "on": bool(on)},
        timeout=3,                 # never leave the request hanging on the page
    )
    response.raise_for_status()    # a failed command must not report success
    POND_ACTUATORS[pond_id][key] = response.json()["on"]   # trust the device
    return POND_ACTUATORS[pond_id][key]
```

The view already catches nothing, so wrap the call and turn a failure into
`messages.error(...)` — an operator being told "the aerator did not respond" is
the entire point of doing it this way.

On the ESP32 (Arduino / ESPHome / MicroPython — any of them), the firmware is
about twenty lines: a `POST /device` route that maps `"pump"` to a GPIO pin,
writes the level, and returns the pin's actual state. Two rules make it safe:
**boot with every relay off**, and **fail safe on lost connectivity** — if no
command has arrived for N minutes and oxygen is low, the controller runs the
aerator on its own.

### Beyond one pond

`set_device()` writing to a module dict is fine while the dict is the only
source of truth. Once controllers report their own state, that reported state
becomes what the page shows, the dict becomes a cache, and both of the current
limits (state resets on restart, each gunicorn worker holds its own copy) go
away in the same change. Poll the controllers on a schedule, or have them POST
their state to Django — either beats guessing.

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

- Configuration comes from the environment or a local `.env` file via
  python-decouple — see `.env.example` for every variable. `DEBUG` defaults to
  **False** and `ALLOWED_HOSTS` to localhost, so a deployment has to opt in to
  debug rather than remember to opt out. Set a real `SECRET_KEY`, and
  `SECURE_SSL=True` once TLS terminates in front of the app.
- Static files are served by whitenoise, so no nginx static config is needed —
  run `python manage.py collectstatic` before serving. Until you do, the dev
  server prints a harmless "No directory at: staticfiles/" warning.
- Three.js and its loaders are vendored under `static/dashboard/vendor/` — no
  npm, no build step.
