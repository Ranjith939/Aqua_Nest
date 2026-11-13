"""
AQUA NEST - dashboard views.

UI-ONLY STAGE
-------------
There are no models, no APIs and no sensor integrations here on purpose.
Every value served to the templates is *static dummy data* declared in this
module. When the real backend arrives, replace the bodies of the ``get_*()``
helpers below with querysets / service calls - the dictionaries they return
are the contract the templates are written against, so the HTML will not
need to change.
"""

from django import forms
from django.contrib import messages
from django.contrib.auth import get_user_model, login, update_session_auth_hash
from django.contrib.auth.decorators import login_not_required
from django.contrib.auth.forms import PasswordChangeForm, UserCreationForm
from django.http import Http404, HttpResponseBadRequest
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone

from . import pond_state


# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------

#: Five primary sections. Each answers one question, which is why there are
#: no separate Dashboard / Analytics / Reports / Alerts / Devices tabs - those
#: are views *within* a section, not sections of their own.
NAV_ITEMS = [
    {"key": "ponds", "label": "Ponds", "icon": "ponds",
     "url": "dashboard:ponds", "badge": None,
     "hint": "What is happening?"},
    {"key": "intelligence", "label": "Intelligence", "icon": "intelligence",
     "url": "dashboard:intelligence", "badge": 2,
     "hint": "Why is it happening?"},
    {"key": "control", "label": "Control", "icon": "control",
     "url": "dashboard:control", "badge": None,
     "hint": "What can we do about it?"},
    {"key": "nest", "label": "Nest", "icon": "nest",
     "url": "dashboard:nest", "badge": None,
     "hint": "Is the device working?"},
    {"key": "life", "label": "Life", "icon": "life",
     "url": "dashboard:life", "badge": None,
     "hint": "How are the fish responding?"},
]

FARMS = [
    {"key": "my-farm", "name": "My Farm", "meta": "Mangalore · 6 ponds"},
    {"key": "delta", "name": "Delta Unit", "meta": "Udupi · 4 ponds"},
    {"key": "coastal", "name": "Coastal Site", "meta": "Kundapura · 9 ponds"},
]


# ---------------------------------------------------------------------------
# Dummy data providers  (swap these for real queries later)
# ---------------------------------------------------------------------------

def get_kpis():
    """Four headline metrics shown directly under the hero."""
    return [
        {
            "key": "ponds",
            "icon": "droplet",
            "label": "Total Ponds",
            "value": "6",
            "count_to": 6,
            "caption": "+1 new this month",
            "tone": "info",
            "trend": "up",
        },
        {
            "key": "devices",
            "icon": "cpu",
            "label": "Active Devices",
            "value": "6 / 6",
            "count_to": None,
            "caption": "All online",
            "tone": "healthy",
            "trend": "steady",
        },
        {
            "key": "health",
            "icon": "heart",
            "label": "Overall Health",
            "value": "Good",
            "count_to": None,
            "caption": "Stable conditions",
            "tone": "healthy",
            "trend": "steady",
        },
        {
            "key": "alerts",
            "icon": "bell",
            "label": "Active Alerts",
            "value": "2",
            "count_to": 2,
            "caption": "Needs attention",
            "tone": "critical",
            "trend": "down",
        },
    ]


#: Plot facts the sensors do not carry - stocking and surface area.
POND_PLOT = {
    1: ("12,400", "0.8 ha"), 2: ("10,850", "0.7 ha"), 3: ("14,200", "1.1 ha"),
    4: ("9,600", "0.6 ha"), 5: ("18,300", "1.4 ha"), 6: ("11,150", "0.9 ha"),
}

#: The farm map already styles good / warning / critical, so the engine's
#: four states fold onto those three. The label still says "Recovering", so
#: nothing is lost - only the tile colour is shared with healthy.
MAP_STATUS = {"HEALTHY": "good", "RECOVERING": "good",
              "WARNING": "warning", "CRITICAL": "critical"}
MAP_LABEL = {"HEALTHY": "Good", "RECOVERING": "Recovering",
             "WARNING": "Warning", "CRITICAL": "Critical"}


def get_ponds():
    """
    The six ponds drawn on the aerial farm map.

    Derived from the pond state engine rather than hand-written, so the map
    can never disagree with the Digital Twin about how a pond is doing.
    """
    rows = []

    for pond_id in sorted(pond_state.POND_READINGS):
        state = pond_state.derive_state(pond_id)
        readings = pond_state.POND_READINGS[pond_id]
        stock, area = POND_PLOT[pond_id]

        rows.append({
            "id": pond_id,
            "name": pond_state.POND_NAMES[pond_id],
            "species": pond_state.POND_SPECIES[pond_id],
            "status": MAP_STATUS[state["pondState"]],
            "status_label": MAP_LABEL[state["pondState"]],
            "temp": f"{readings['water_temperature']:.1f}",
            "ph": f"{readings['ph']:.1f}",
            "do": f"{readings['dissolved_oxygen']:.1f}",
            "stock": stock,
            "area": area,
        })

    return rows


def get_alerts():
    """Recent alerts panel."""
    return [
        {
            "id": 1, "pond": "Pond 5", "title": "Dissolved oxygen low",
            "detail": "3.4 mg/L · below the 4.0 mg/L threshold",
            "level": "critical", "icon": "alert-triangle", "time": "10 min ago",
        },
        {
            "id": 2, "pond": "Pond 3", "title": "pH out of range",
            "detail": "8.6 pH · above the safe band for tilapia",
            "level": "warning", "icon": "alert-circle", "time": "32 min ago",
        },
        {
            "id": 3, "pond": "Pond 2", "title": "Device back online",
            "detail": "Sensor node AQN-2204 reconnected",
            "level": "info", "icon": "info", "time": "1 hr ago",
        },
        {
            "id": 4, "pond": "Pond 6", "title": "Aerator cycle completed",
            "detail": "Scheduled run finished in 42 min",
            "level": "healthy", "icon": "check", "time": "2 hr ago",
        },
    ]


def get_activity():
    """Recent activity timeline."""
    return [
        {
            "icon": "bolt", "tone": "healthy", "title": "Aerator switched on",
            "detail": "Pond 5 · automatic response to low oxygen",
            "time": "09:42",
        },
        {
            "icon": "flask", "tone": "info", "title": "Water sample logged",
            "detail": "Pond 3 · manual entry by Charith", "time": "08:15",
        },
        {
            "icon": "file", "tone": "info", "title": "Weekly report generated",
            "detail": "Farm summary · 22 May 2026", "time": "07:30",
        },
        {
            "icon": "cpu", "tone": "warning", "title": "Firmware update queued",
            "detail": "4 sensor nodes · v2.4.1", "time": "06:58",
        },
        {
            "icon": "droplet", "tone": "healthy", "title": "Feeding cycle complete",
            "detail": "Ponds 1, 2, 4, 6 · 86 kg dispensed", "time": "06:10",
        },
    ]


def get_quick_actions():
    return [
        {"key": "live", "icon": "pulse", "label": "View Live Data",
         "caption": "Real-time streams"},
        {"key": "report", "icon": "file", "label": "Generate Report",
         "caption": "PDF / CSV export"},
        {"key": "devices", "icon": "cpu", "label": "Manage Devices",
         "caption": "6 nodes online"},
        {"key": "settings", "icon": "sliders", "label": "Farm Settings",
         "caption": "Thresholds & alerts"},
    ]


def get_device_health():
    """Aqua Core status strip inside the alerts column."""
    return [
        {"label": "Node array", "value": "6 / 6", "pct": 100, "tone": "healthy"},
        {"label": "Link uptime", "value": "99.2%", "pct": 99, "tone": "healthy"},
        {"label": "Battery average", "value": "78%", "pct": 78, "tone": "info"},
        {"label": "Storage used", "value": "41%", "pct": 41, "tone": "info"},
    ]


# ---------------------------------------------------------------------------
# Water quality chart (dummy series, rendered client side as SVG)
# ---------------------------------------------------------------------------

#: One day of readings sampled every two hours.
CHART_LABELS = [
    "00:00", "02:00", "04:00", "06:00", "08:00", "10:00", "12:00",
    "14:00", "16:00", "18:00", "20:00", "22:00", "24:00",
]

#: Baseline diurnal curves for Pond 1.
BASE_SERIES = {
    "temperature": [26.4, 26.1, 25.9, 26.3, 27.2, 28.1, 28.9,
                    29.4, 29.1, 28.4, 27.6, 27.0, 26.6],
    "ph": [7.9, 7.8, 7.7, 7.6, 7.7, 7.9, 8.1,
           8.2, 8.1, 7.9, 7.8, 7.9, 8.0],
    "oxygen": [6.4, 6.0, 5.7, 5.5, 5.9, 6.6, 7.2,
               7.6, 7.4, 6.9, 6.5, 6.3, 6.5],
}

#: Fixed per-pond offsets so every pond shows a slightly different - but
#: always deterministic - dummy curve. (temperature, pH, oxygen)
POND_OFFSETS = {
    1: (0.0, 0.00, 0.0),
    2: (-0.4, -0.15, 0.3),
    3: (1.7, 0.70, -0.6),
    4: (-0.8, -0.25, 0.5),
    5: (2.6, -0.55, -2.9),
    6: (0.3, -0.05, 0.2),
}

SERIES_META = [
    {"key": "temperature", "label": "Temperature", "unit": "°C",
     "color": "#57C7FF", "decimals": 1},
    {"key": "ph", "label": "pH", "unit": "",
     "color": "#6FE7DD", "decimals": 2},
    {"key": "oxygen", "label": "Dissolved O₂", "unit": "mg/L",
     "color": "#FFD166", "decimals": 1},
]


def _shift(values, delta, wobble):
    """Deterministic variation of a baseline curve - no randomness."""
    out = []
    for index, value in enumerate(values):
        # A tiny alternating ripple keeps each pond visually distinct.
        ripple = wobble * (0.5 if index % 2 else -0.5)
        out.append(round(value + delta + ripple, 2))
    return out


def get_chart_data():
    """Chart payload consumed by ``static/dashboard/js/chart.js``."""
    ponds = {}
    for pond_id, (d_temp, d_ph, d_oxygen) in POND_OFFSETS.items():
        ponds[str(pond_id)] = {
            "temperature": _shift(BASE_SERIES["temperature"], d_temp, 0.12),
            "ph": _shift(BASE_SERIES["ph"], d_ph, 0.03),
            "oxygen": _shift(BASE_SERIES["oxygen"], d_oxygen, 0.08),
        }
    return {"labels": CHART_LABELS, "series": SERIES_META, "ponds": ponds}


# ---------------------------------------------------------------------------
# Presentation helpers
# ---------------------------------------------------------------------------

def _greeting(hour):
    if hour < 12:
        return "Good Morning"
    if hour < 17:
        return "Good Afternoon"
    return "Good Evening"


def _farm_user(user):
    """The signed-in account, shaped for the top bar and hero."""
    full_name = user.get_full_name() or user.get_username()
    return {
        "name": user.first_name or user.get_username(),
        "full_name": full_name,
        "role": "Administrator" if user.is_superuser else "Farm Manager",
        "initials": "".join(word[0] for word in full_name.split()[:2]).upper(),
    }


def base_context(request, active):
    """Everything the shell (sidebar + top bar + background) needs."""
    # localtime(), not datetime.now(): the greeting has to follow the farm's
    # TIME_ZONE, not whatever clock the server happens to run on.
    now = timezone.localtime()
    return {
        "active": active,
        "nav_items": NAV_ITEMS,
        "farms": FARMS,
        "current_farm": FARMS[0],
        "farm_user": _farm_user(request.user),
        "notifications_count": 3,
        # The top-bar notification popover renders on every page.
        "alerts": get_alerts(),
        "weather": {
            "temp": "28",
            "condition": "Partly Cloudy",
            "icon": "cloud-sun",
            "humidity": "74%",
        },
        "now": now,
        "greeting": _greeting(now.hour),
    }


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

def ponds(request):
    """
    The home dashboard: one pond, understood at a glance.

    The Living Digital Twin is the hero. Everything else on the page is the
    technical evidence behind what the twin is showing.
    """
    context = base_context(request, "ponds")

    ponds_payload = pond_state.build_all_ponds()
    selected = request.GET.get("pond", "1")
    if selected not in ponds_payload:
        selected = "1"

    context.update({
        "page_title": "Ponds",
        # Twin + evidence
        "pond_payload": ponds_payload,
        "selected_pond": selected,
        "pond": ponds_payload[selected],
        "pond_ids": sorted(ponds_payload, key=int),
        # Farm-wide panels carried over from the previous dashboard.
        "ponds": get_ponds(),
        "kpis": get_kpis(),
        "activity": get_activity(),
        "quick_actions": get_quick_actions(),
        "device_health": get_device_health(),
        "chart_data": get_chart_data(),
    })
    return render(request, "dashboard/ponds.html", context)


# ---------------------------------------------------------------------------
# Control
# ---------------------------------------------------------------------------

def _selected_pond(request, payload):
    """The pond in ``?pond=`` if it exists, else the first one."""
    selected = request.GET.get("pond") or request.POST.get("pond") or "1"
    return selected if selected in payload else "1"


def get_devices(pond_id):
    """One row per switchable device, ready for the template."""
    actuators = pond_state.POND_ACTUATORS[pond_id]
    return [
        dict(spec, on=actuators[spec["key"]],
             state="ON" if actuators[spec["key"]] else "OFF")
        for spec in pond_state.DEVICES
    ]


def control(request):
    """
    Run the pond equipment.

    A POST flips exactly one device and redirects back, so a refresh cannot
    re-fire a command - the browser has nothing to resubmit. That is also why
    there is no JavaScript here: the page is the whole control surface, and it
    keeps working on a phone with a bad connection at the pond edge.
    """
    payload = pond_state.build_all_ponds()
    selected = _selected_pond(request, payload)
    pond_id = int(selected)

    if request.method == "POST":
        key = request.POST.get("device", "")
        turn_on = request.POST.get("state") == "on"

        # The form is ours, so an unknown key means the request was hand-made.
        if key not in pond_state.DEVICE_KEYS:
            return HttpResponseBadRequest("Unknown device")

        label = next(d["label"] for d in pond_state.DEVICES if d["key"] == key)
        oxygen = pond_state.derive_state(pond_id)["oxygenState"]

        # The one interlock worth having before the rest exist: switching the
        # aerator off in a pond that is already oxygen-critical is how a stock
        # is lost in an afternoon. Everything else is reversible in seconds.
        if key == "aeration" and not turn_on and oxygen == "CRITICAL":
            messages.error(
                request,
                f"Aerator held ON - {payload[selected]['name']} is "
                f"oxygen-critical. Clear the oxygen alert first.",
            )
        else:
            pond_state.set_device(pond_id, key, turn_on)
            messages.success(
                request,
                f"{label} switched {'ON' if turn_on else 'OFF'} "
                f"on {payload[selected]['name']}.",
            )

        return redirect(f"{reverse('dashboard:control')}?pond={selected}")

    context = base_context(request, "control")
    context.update({
        "page_title": "Control",
        "pond": payload[selected],
        "selected_pond": selected,
        "pond_ids": sorted(payload, key=int),
        "devices": get_devices(pond_id),
        "feeder": pond_state.POND_ACTUATORS[pond_id]["feeder"],
    })
    return render(request, "dashboard/control.html", context)


def dashboard(request):
    context = base_context(request, "dashboard")
    context.update({
        "page_title": "Dashboard",
        "kpis": get_kpis(),
        "ponds": get_ponds(),
        "activity": get_activity(),
        "quick_actions": get_quick_actions(),
        "device_health": get_device_health(),
        "chart_data": get_chart_data(),
    })
    return render(request, "dashboard/dashboard.html", context)


#: Placeholder blurbs so every sidebar link leads somewhere presentable
#: while the rest of the platform is still being built.
PLACEHOLDER_PAGES = {
    "intelligence": ("Intelligence",
                     "Why it is happening and what comes next: anomaly "
                     "detection, risk analysis, trends and plain-language "
                     "explanations of the pond's behaviour."),
    "nest": ("Nest",
             "The health of the AQUA NEST unit itself: sensor status, "
             "ESP32 state, battery, solar input and connectivity."),
    "life": ("Life",
             "Fish behaviour and fish-health intelligence, built around "
             "computer vision once the camera feed is in place."),
}


def placeholder(request, key):
    """Renders a styled 'next milestone' page for the non-dashboard routes."""
    if key not in PLACEHOLDER_PAGES:
        raise Http404("Unknown page")
    title, blurb = PLACEHOLDER_PAGES[key]
    context = base_context(request, key)
    context.update({"page_title": title, "blurb": blurb})
    return render(request, "dashboard/placeholder.html", context)


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

class SignupForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        fields = ("username", "first_name", "email")


@login_not_required
def signup(request):
    """Public sign-up: create the account and go straight to the dashboard."""
    if request.user.is_authenticated:
        return redirect("dashboard:ponds")
    form = SignupForm(request.POST or None)
    if form.is_valid():
        login(request, form.save())
        return redirect("dashboard:ponds")
    return render(request, "dashboard/auth.html", {"form": form, "mode": "signup"})


ProfileForm = forms.modelform_factory(
    get_user_model(), fields=("first_name", "last_name", "email"))


def account(request):
    """Preferences: edit your name/email, or change your password."""
    profile = ProfileForm(instance=request.user)
    password = PasswordChangeForm(request.user)

    if request.method == "POST":
        action = request.POST.get("action")
        if action == "profile":
            profile = ProfileForm(request.POST, instance=request.user)
            if profile.is_valid():
                profile.save()
                messages.success(request, "Profile saved.")
                return redirect("account")
        elif action == "password":
            password = PasswordChangeForm(request.user, request.POST)
            if password.is_valid():
                # Keeps this session signed in; other sessions are logged out.
                update_session_auth_hash(request, password.save())
                messages.success(request, "Password changed.")
                return redirect("account")
        else:
            return HttpResponseBadRequest("Unknown action")

    context = base_context(request, "account")
    context.update({"page_title": "Account", "profile_form": profile,
                    "password_form": password})
    return render(request, "dashboard/account.html", context)
