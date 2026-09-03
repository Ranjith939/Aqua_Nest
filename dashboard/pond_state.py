"""
AQUA NEST - pond telemetry and the pond state engine.

    SENSOR DATA  ->  POND STATE ENGINE  ->  DIGITAL TWIN

The Digital Twin never reads a sensor value. It reads the small state object
produced here, so when the real IoT feed and the AI models land, only the
readings at the top of this module get replaced - the interpretation layer and
the entire visual system stay as they are.

EVERY READING IN THIS MODULE IS DEMO DATA. Nothing here is measured, and the
UI labels it as simulated wherever it is shown.
"""

# ---------------------------------------------------------------------------
# Operating bands
# ---------------------------------------------------------------------------

#: PROVISIONAL operating bands, deliberately kept in one place so they can be
#: retuned without touching the engine or the visuals. These are placeholders
#: for values that should come from species-specific and scientific
#: validation - they are not published thresholds for any species.
#:
#:   good  - the range we treat as normal operation
#:   watch - outside good but not yet an incident
#:   anything beyond watch is treated as critical
SENSOR_BANDS = {
    "dissolved_oxygen": {"good": (5.0, 11.0), "watch": (4.0, 13.0)},
    "ph": {"good": (6.8, 8.2), "watch": (6.3, 8.7)},
    "water_temperature": {"good": (24.0, 30.0), "watch": (21.0, 32.0)},
    "tds": {"good": (150.0, 500.0), "watch": (100.0, 700.0)},
    "water_level": {"good": (60.0, 100.0), "watch": (45.0, 100.0)},
    "flow": {"good": (2.0, 6.0), "watch": (1.0, 8.0)},
    "air_temperature": {"good": (20.0, 34.0), "watch": (16.0, 38.0)},
    "humidity": {"good": (50.0, 85.0), "watch": (35.0, 92.0)},
}

#: Display metadata. `steady` is the wording used when the value is in band -
#: some parameters read more naturally as GOOD, others as NORMAL.
SENSORS = [
    {"key": "dissolved_oxygen", "label": "Dissolved Oxygen", "unit": "mg/L",
     "decimals": 1, "steady": "GOOD", "weight": 0.30, "icon": "droplet"},
    {"key": "ph", "label": "pH", "unit": "",
     "decimals": 1, "steady": "GOOD", "weight": 0.16, "icon": "flask"},
    {"key": "water_temperature", "label": "Water Temperature", "unit": "°C",
     "decimals": 1, "steady": "NORMAL", "weight": 0.12, "icon": "thermometer"},
    {"key": "tds", "label": "TDS", "unit": "ppm",
     "decimals": 0, "steady": "NORMAL", "weight": 0.12, "icon": "analytics"},
    {"key": "water_level", "label": "Water Level", "unit": "%",
     "decimals": 0, "steady": "NORMAL", "weight": 0.12, "icon": "droplet"},
    {"key": "flow", "label": "Flow", "unit": "L/min",
     "decimals": 1, "steady": "NORMAL", "weight": 0.08, "icon": "pulse"},
    {"key": "air_temperature", "label": "Air Temperature", "unit": "°C",
     "decimals": 1, "steady": "NORMAL", "weight": 0.05, "icon": "cloud-sun"},
    {"key": "humidity", "label": "Humidity", "unit": "%",
     "decimals": 0, "steady": "NORMAL", "weight": 0.05, "icon": "cloud-sun"},
]

#: Health score bands. Configurable for the same reason as SENSOR_BANDS.
HEALTH_BANDS = [
    (90, "Excellent", "healthy"),
    (75, "Good", "healthy"),
    (50, "Warning", "warning"),
    (25, "Poor", "warning"),
    (0, "Critical", "critical"),
]


# ---------------------------------------------------------------------------
# Demo readings
# ---------------------------------------------------------------------------

#: One reading set per pond. Chosen so the six ponds between them exercise
#: every visual state the twin can render: healthy, recovering, warning,
#: critical, low water, aeration running and water-quality degradation.
POND_READINGS = {
    1: {"dissolved_oxygen": 6.8, "ph": 7.4, "water_temperature": 27.4,
        "tds": 312, "water_level": 88, "flow": 3.2,
        "air_temperature": 28.4, "humidity": 74},

    2: {"dissolved_oxygen": 4.6, "ph": 7.2, "water_temperature": 27.9,
        "tds": 388, "water_level": 81, "flow": 4.6,
        "air_temperature": 28.4, "humidity": 74},

    3: {"dissolved_oxygen": 5.4, "ph": 8.6, "water_temperature": 29.2,
        "tds": 760, "water_level": 79, "flow": 2.8,
        "air_temperature": 30.1, "humidity": 68},

    4: {"dissolved_oxygen": 6.4, "ph": 7.6, "water_temperature": 26.8,
        "tds": 284, "water_level": 47, "flow": 1.4,
        "air_temperature": 28.4, "humidity": 74},

    5: {"dissolved_oxygen": 3.1, "ph": 7.1, "water_temperature": 30.4,
        "tds": 540, "water_level": 72, "flow": 5.1,
        "air_temperature": 31.2, "humidity": 79},

    6: {"dissolved_oxygen": 7.1, "ph": 7.5, "water_temperature": 27.6,
        "tds": 268, "water_level": 91, "flow": 3.4,
        "air_temperature": 28.4, "humidity": 74},
}

#: Actuator state per pond. Ponds 2 and 5 are being aerated, which the twin
#: shows as bubbles and surface movement.
POND_ACTUATORS = {
    1: {"aeration": False, "pump": False, "feeder": "5:30 PM"},
    2: {"aeration": True, "pump": True, "feeder": "5:30 PM"},
    3: {"aeration": False, "pump": True, "feeder": "5:45 PM"},
    4: {"aeration": False, "pump": True, "feeder": "6:00 PM"},
    5: {"aeration": True, "pump": True, "feeder": "Paused"},
    6: {"aeration": False, "pump": False, "feeder": "5:30 PM"},
}

#: Short trend hint per pond: which way dissolved oxygen has been moving.
#: Separating this from the instantaneous reading is what lets the engine tell
#: "sliding into trouble" apart from "climbing back out of it".
POND_TREND = {1: "steady", 2: "rising", 3: "steady", 4: "steady",
              5: "falling", 6: "steady"}

POND_NAMES = {1: "Pond 1", 2: "Pond 2", 3: "Pond 3",
              4: "Pond 4", 5: "Pond 5", 6: "Pond 6"}

POND_SPECIES = {1: "Rohu", 2: "Catla", 3: "Tilapia",
                4: "Rohu", 5: "Shrimp", 6: "Catla"}


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify(key, value):
    """GOOD/NORMAL, WATCH or CRITICAL for a single reading."""
    bands = SENSOR_BANDS.get(key)
    if not bands:
        return "NORMAL"

    good_low, good_high = bands["good"]
    watch_low, watch_high = bands["watch"]

    if good_low <= value <= good_high:
        return "IN_BAND"
    if watch_low <= value <= watch_high:
        return "WATCH"
    return "CRITICAL"


def _closeness(key, value):
    """
    How centred a reading sits inside its good band, 0..1.

    Used so a pond sitting at the very edge of acceptable does not score the
    same as one sitting comfortably mid-band.
    """
    good_low, good_high = SENSOR_BANDS[key]["good"]
    centre = (good_low + good_high) / 2
    half = (good_high - good_low) / 2 or 1
    return max(0.0, 1.0 - abs(value - centre) / half)


#: What each classification is worth when scoring pond health.
STATUS_WEIGHT = {"WATCH": 0.55, "CRITICAL": 0.15}


def build_sensors(pond_id):
    """The sensor panel rows for one pond."""
    readings = POND_READINGS[pond_id]
    rows = []

    for spec in SENSORS:
        value = readings[spec["key"]]
        state = classify(spec["key"], value)
        status = spec["steady"] if state == "IN_BAND" else state

        rows.append({
            "key": spec["key"],
            "label": spec["label"],
            "unit": spec["unit"],
            "icon": spec["icon"],
            "value": f"{value:.{spec['decimals']}f}",
            "status": status,
            # Drives the colour: the palette already has healthy/warning/
            # critical, so the panel needs no new visual vocabulary.
            "tone": {"WATCH": "warning", "CRITICAL": "critical"}.get(status, "healthy"),
        })

    return rows


def health_score(pond_id):
    """Weighted 0-100 score plus its band."""
    readings = POND_READINGS[pond_id]
    total = 0.0

    for spec in SENSORS:
        key = spec["key"]
        state = classify(key, readings[key])

        if state == "IN_BAND":
            # 0.85..1.0 depending on how centred the reading is, so a healthy
            # pond does not always read a flat 100.
            sub = 0.85 + 0.15 * _closeness(key, readings[key])
        else:
            sub = STATUS_WEIGHT[state]

        total += spec["weight"] * sub

    score = int(round(total * 100))

    for floor, label, tone in HEALTH_BANDS:
        if score >= floor:
            return {"score": score, "band": label, "tone": tone}

    return {"score": score, "band": "Critical", "tone": "critical"}


# ---------------------------------------------------------------------------
# The state engine
# ---------------------------------------------------------------------------

def derive_state(pond_id):
    """
    Turn readings into the small interpreted state the Digital Twin renders.

    This is the whole contract between data and visuals. The twin switches on
    these strings and nothing else - it never sees a mg/L figure - so the
    visual system survives the backend being swapped in underneath it.
    """
    readings = POND_READINGS[pond_id]
    actuators = POND_ACTUATORS[pond_id]
    trend = POND_TREND[pond_id]

    oxygen = classify("dissolved_oxygen", readings["dissolved_oxygen"])
    level = classify("water_level", readings["water_level"])

    # Water quality is a composite: pH and dissolved solids together say more
    # about clarity than either does alone.
    quality_inputs = [classify("ph", readings["ph"]),
                      classify("tds", readings["tds"])]

    if "CRITICAL" in quality_inputs:
        water_quality = "DEGRADED"
    elif "WATCH" in quality_inputs:
        water_quality = "DECLINING"
    else:
        water_quality = "GOOD"

    oxygen_state = {"IN_BAND": "NORMAL", "WATCH": "LOW",
                    "CRITICAL": "CRITICAL"}[oxygen]
    water_level_state = {"IN_BAND": "NORMAL", "WATCH": "LOW",
                         "CRITICAL": "CRITICAL"}[level]

    # Overall pond state. Recovery is deliberately its own state rather than
    # a shade of warning: a pond climbing back out with aeration running
    # should not look the same as one sliding into trouble.
    if oxygen_state == "CRITICAL" or water_quality == "DEGRADED":
        pond_state = "CRITICAL" if oxygen_state == "CRITICAL" else "WARNING"
    elif oxygen_state == "LOW":
        pond_state = "RECOVERING" if trend == "rising" else "WARNING"
    elif water_quality == "DECLINING" or water_level_state != "NORMAL":
        pond_state = "WARNING"
    else:
        pond_state = "HEALTHY"

    # Fish behaviour follows oxygen first - that is what actually changes how
    # a shoal moves - then overall condition.
    if oxygen_state == "CRITICAL":
        fish_activity = "SURFACING"
    elif pond_state == "RECOVERING":
        fish_activity = "RECOVERING"
    elif oxygen_state == "LOW" or water_quality != "GOOD":
        fish_activity = "REDUCED"
    else:
        fish_activity = "NORMAL"

    return {
        "pondState": pond_state,
        "oxygenState": oxygen_state,
        "waterQualityState": water_quality,
        "waterLevelState": water_level_state,
        "fishActivityState": fish_activity,
        "aeratorState": "ON" if actuators["aeration"] else "OFF",
        # Raw-ish hints the twin uses for magnitude, not for meaning.
        "waterLevelPercent": readings["water_level"],
        "flow": readings["flow"],
    }


# ---------------------------------------------------------------------------
# Plain-language condition
# ---------------------------------------------------------------------------

def describe_condition(pond_id, state):
    """
    What is happening, in a sentence.

    Deliberately describes only what the readings support. Water quality is
    reported as degradation, never as a named contaminant - nothing in this
    sensor set can identify one.
    """
    pond = POND_NAMES[pond_id]

    if state["pondState"] == "CRITICAL":
        return {
            "tone": "critical",
            "headline": "Oxygen Stress Detected",
            "detail": (
                f"Dissolved oxygen in {pond} has fallen below the safe "
                f"operating band and is still declining. Aeration is running "
                f"and fish are moving toward the surface."
            ),
        }

    if state["pondState"] == "RECOVERING":
        return {
            "tone": "info",
            "headline": "Recovering",
            "detail": (
                f"Dissolved oxygen in {pond} is climbing back toward the "
                f"normal band with aeration running. Fish activity is "
                f"returning to normal."
            ),
        }

    if state["waterQualityState"] == "DEGRADED":
        return {
            "tone": "warning",
            "headline": "Water Quality Degradation",
            "detail": (
                f"pH and dissolved solids in {pond} are outside the expected "
                f"range and the water has become cloudy. The cause is not "
                f"identified from these parameters alone."
            ),
        }

    if state["waterLevelState"] != "NORMAL":
        return {
            "tone": "warning",
            "headline": "Water Level Low",
            "detail": (
                f"The water level in {pond} has dropped below the normal "
                f"operating range. Other parameters remain within band."
            ),
        }

    if state["pondState"] == "WARNING":
        return {
            "tone": "warning",
            "headline": "Conditions Drifting",
            "detail": (
                f"One or more parameters in {pond} have moved outside the "
                f"normal band. The pond has entered a warning condition."
            ),
        }

    return {
        "tone": "healthy",
        "headline": "Pond conditions are stable",
        "detail": (
            f"Dissolved oxygen and water parameters in {pond} are currently "
            f"within the expected operating range."
        ),
    }


# ---------------------------------------------------------------------------
# Payload
# ---------------------------------------------------------------------------

def build_pond(pond_id):
    """Everything the Ponds page needs for one pond."""
    state = derive_state(pond_id)
    actuators = POND_ACTUATORS[pond_id]

    return {
        "id": pond_id,
        "name": POND_NAMES[pond_id],
        "species": POND_SPECIES[pond_id],
        "sensors": build_sensors(pond_id),
        "health": health_score(pond_id),
        "state": state,
        "condition": describe_condition(pond_id, state),
        "actuators": {
            "aeration": "ON" if actuators["aeration"] else "OFF",
            "pump": "ON" if actuators["pump"] else "OFF",
            "feeder": actuators["feeder"],
        },
    }


def build_all_ponds():
    """Every pond, keyed by id as a string for the JSON payload."""
    return {str(pond_id): build_pond(pond_id) for pond_id in sorted(POND_READINGS)}
