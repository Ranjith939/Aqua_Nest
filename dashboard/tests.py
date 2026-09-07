"""Tests for the pond state engine and the page views.

The engine is the one piece of real logic in a UI-only project: readings in,
interpreted state out. It is also the piece meant to survive the backend being
swapped in underneath it, so it is the piece worth pinning down.

Run with:  python manage.py test
"""

import copy

from django.test import TestCase
from django.urls import reverse

from . import pond_state, views


class ClassifyTests(TestCase):
    """Band edges — the values most likely to be got wrong by a retune."""

    def test_mid_band_is_in_band(self):
        self.assertEqual(pond_state.classify("ph", 7.5), "IN_BAND")

    def test_good_band_edges_are_inclusive(self):
        low, high = pond_state.SENSOR_BANDS["ph"]["good"]
        self.assertEqual(pond_state.classify("ph", low), "IN_BAND")
        self.assertEqual(pond_state.classify("ph", high), "IN_BAND")

    def test_between_good_and_watch_is_watch(self):
        self.assertEqual(pond_state.classify("ph", 6.5), "WATCH")

    def test_outside_watch_is_critical(self):
        self.assertEqual(pond_state.classify("ph", 9.9), "CRITICAL")
        self.assertEqual(pond_state.classify("ph", 3.0), "CRITICAL")

    def test_unknown_sensor_does_not_raise(self):
        # build_sensors() would crash on a sensor added to SENSORS before
        # SENSOR_BANDS; the engine degrades to NORMAL instead.
        self.assertEqual(pond_state.classify("salinity", 12), "NORMAL")


class ClosenessTests(TestCase):
    def test_band_centre_scores_one(self):
        low, high = pond_state.SENSOR_BANDS["ph"]["good"]
        self.assertAlmostEqual(pond_state._closeness("ph", (low + high) / 2), 1.0)

    def test_band_edge_scores_zero(self):
        low, _ = pond_state.SENSOR_BANDS["ph"]["good"]
        self.assertAlmostEqual(pond_state._closeness("ph", low), 0.0)

    def test_never_goes_negative(self):
        self.assertEqual(pond_state._closeness("ph", 0.0), 0.0)


class HealthScoreTests(TestCase):
    def test_weights_sum_to_one(self):
        # If they do not, a perfect pond cannot reach 100 and the HEALTH_BANDS
        # thresholds quietly mean something other than what they say.
        self.assertAlmostEqual(sum(s["weight"] for s in pond_state.SENSORS), 1.0)

    def test_score_stays_in_range_for_every_pond(self):
        for pond_id in pond_state.POND_READINGS:
            with self.subTest(pond=pond_id):
                health = pond_state.health_score(pond_id)
                self.assertGreaterEqual(health["score"], 0)
                self.assertLessEqual(health["score"], 100)
                self.assertIn(health["tone"], {"healthy", "warning", "critical"})

    def test_band_matches_the_score(self):
        for pond_id in pond_state.POND_READINGS:
            health = pond_state.health_score(pond_id)
            expected = next(
                (label for floor, label, _ in pond_state.HEALTH_BANDS
                 if health["score"] >= floor),
                "Critical",
            )
            self.assertEqual(health["band"], expected, msg=f"pond {pond_id}")

    def test_a_healthier_pond_scores_higher(self):
        # Pond 1 is the all-in-band demo pond; pond 3 has critical TDS and pH.
        self.assertGreater(
            pond_state.health_score(1)["score"],
            pond_state.health_score(3)["score"],
        )


class BuildPondTests(TestCase):
    """The dict shape here is the contract the templates are written against."""

    def test_every_pond_builds_with_the_expected_keys(self):
        for pond_id in pond_state.POND_READINGS:
            with self.subTest(pond=pond_id):
                pond = pond_state.build_pond(pond_id)
                self.assertEqual(
                    set(pond),
                    {"id", "name", "species", "sensors", "health", "state",
                     "condition", "actuators"},
                )
                self.assertEqual(len(pond["sensors"]), len(pond_state.SENSORS))
                self.assertIn(pond["actuators"]["aeration"], {"ON", "OFF"})
                self.assertIn(pond["actuators"]["pump"], {"ON", "OFF"})

    def test_demo_data_covers_every_pond_id(self):
        # A pond added to POND_READINGS but not to the others crashes
        # build_pond() at render time; catch it here instead.
        ids = set(pond_state.POND_READINGS)
        for name, table in (
            ("POND_ACTUATORS", pond_state.POND_ACTUATORS),
            ("POND_TREND", pond_state.POND_TREND),
            ("POND_NAMES", pond_state.POND_NAMES),
            ("POND_SPECIES", pond_state.POND_SPECIES),
            ("POND_PLOT", views.POND_PLOT),
        ):
            self.assertEqual(set(table), ids, msg=name)

    def test_every_sensor_has_a_band_and_a_reading(self):
        keys = {spec["key"] for spec in pond_state.SENSORS}
        self.assertEqual(keys, set(pond_state.SENSOR_BANDS))
        for pond_id, readings in pond_state.POND_READINGS.items():
            self.assertEqual(set(readings), keys, msg=f"pond {pond_id}")

    def test_build_all_ponds_is_keyed_by_string_id(self):
        payload = pond_state.build_all_ponds()
        self.assertEqual(set(payload), {str(i) for i in pond_state.POND_READINGS})


class PageTests(TestCase):
    """Smoke tests: every route in the sidebar renders."""

    def test_ponds_page_renders(self):
        response = self.client.get(reverse("dashboard:ponds"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["selected_pond"], "1")

    def test_pond_query_param_selects_that_pond(self):
        response = self.client.get(reverse("dashboard:ponds"), {"pond": "3"})
        self.assertEqual(response.context["selected_pond"], "3")

    def test_unknown_pond_falls_back_to_the_first(self):
        # request.GET is user input: an unknown or junk id must not 500.
        for bad in ("99", "", "../../etc/passwd"):
            with self.subTest(pond=bad):
                response = self.client.get(reverse("dashboard:ponds"), {"pond": bad})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.context["selected_pond"], "1")

    def test_overview_page_renders(self):
        self.assertEqual(self.client.get(reverse("dashboard:overview")).status_code, 200)

    def test_every_placeholder_section_renders(self):
        for key in views.PLACEHOLDER_PAGES:
            with self.subTest(section=key):
                response = self.client.get(reverse(f"dashboard:{key}"))
                self.assertEqual(response.status_code, 200)

    def test_every_nav_item_points_at_a_real_route(self):
        for item in views.NAV_ITEMS:
            with self.subTest(nav=item["key"]):
                self.assertEqual(self.client.get(reverse(item["url"])).status_code, 200)


class GreetingTests(TestCase):
    def test_greeting_follows_the_clock(self):
        self.assertEqual(views._greeting(9), "Good Morning")
        self.assertEqual(views._greeting(14), "Good Afternoon")
        self.assertEqual(views._greeting(20), "Good Evening")
        # Boundaries: noon is afternoon, midnight is morning.
        self.assertEqual(views._greeting(12), "Good Afternoon")
        self.assertEqual(views._greeting(0), "Good Morning")


class ControlTests(TestCase):
    """
    The one page that changes something.

    POND_ACTUATORS is module state, so every test here restores it - otherwise
    a switch flipped in one test decides the outcome of the next.
    """

    def setUp(self):
        self._saved = copy.deepcopy(pond_state.POND_ACTUATORS)
        self.addCleanup(self._restore)

    def _restore(self):
        pond_state.POND_ACTUATORS.clear()
        pond_state.POND_ACTUATORS.update(self._saved)

    def _post(self, **data):
        return self.client.post(reverse("dashboard:control"), data)

    def test_page_renders_a_card_per_switchable_device(self):
        response = self.client.get(reverse("dashboard:control"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["devices"]), len(pond_state.DEVICES))

    def test_switching_a_device_on_sticks(self):
        # Pond 1's pump starts off.
        self.assertFalse(pond_state.POND_ACTUATORS[1]["pump"])
        response = self._post(pond="1", device="pump", state="on")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(pond_state.POND_ACTUATORS[1]["pump"])

    def test_switching_a_device_off_sticks(self):
        pond_state.POND_ACTUATORS[1]["light"] = True
        self._post(pond="1", device="light", state="off")
        self.assertFalse(pond_state.POND_ACTUATORS[1]["light"])

    def test_post_redirects_back_to_the_same_pond(self):
        response = self._post(pond="3", device="light", state="on")
        self.assertEqual(response["Location"], "/control/?pond=3")

    def test_aerator_cannot_be_switched_off_while_oxygen_is_critical(self):
        # Pond 5 is the oxygen-critical one, and its aerator is running.
        self.assertEqual(pond_state.derive_state(5)["oxygenState"], "CRITICAL")
        self.assertTrue(pond_state.POND_ACTUATORS[5]["aeration"])

        self._post(pond="5", device="aeration", state="off")

        self.assertTrue(pond_state.POND_ACTUATORS[5]["aeration"])

    def test_the_interlock_only_guards_the_aerator(self):
        # A critical pond must not become un-operable in every other respect.
        self._post(pond="5", device="light", state="off")
        self.assertFalse(pond_state.POND_ACTUATORS[5]["light"])

    def test_unknown_device_is_rejected(self):
        response = self._post(pond="1", device="reactor", state="on")
        self.assertEqual(response.status_code, 400)

    def test_unknown_pond_falls_back_instead_of_500ing(self):
        response = self._post(pond="99", device="pump", state="on")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(pond_state.POND_ACTUATORS[1]["pump"])

    def test_set_device_rejects_a_key_outside_the_device_list(self):
        # The feeder is in POND_ACTUATORS but is not switchable.
        with self.assertRaises(KeyError):
            pond_state.set_device(1, "feeder", True)
