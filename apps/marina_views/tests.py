"""Tests for the Marina Views domain logic.

Every case below uses `SimpleTestCase` and unsaved model instances, so the
suite runs without creating a test database. That is a deliberate consequence
of `geometry` being pure and `sight_lines()` accepting its landmarks as an
argument.
"""

from django.test import SimpleTestCase

from . import geometry, visibility
from .models import Landmark, Viewpoint

# Reference coordinates, checked against published figures.
MARINA_GREEN = (37.8060, -122.4420)
GOLDEN_GATE_BRIDGE = (37.8199, -122.4783)
ALCATRAZ = (37.8267, -122.4230)


class HaversineTests(SimpleTestCase):

    def test_zero_distance_between_identical_points(self):
        self.assertAlmostEqual(
            geometry.haversine_km(*MARINA_GREEN, *MARINA_GREEN), 0.0, places=9)

    def test_known_short_distance(self):
        # Marina Green to the Golden Gate Bridge is a little over 3 km.
        distance = geometry.haversine_km(*MARINA_GREEN, *GOLDEN_GATE_BRIDGE)
        self.assertAlmostEqual(distance, 3.5, delta=0.4)

    def test_one_degree_of_latitude_is_about_111km(self):
        self.assertAlmostEqual(geometry.haversine_km(0.0, 0.0, 1.0, 0.0),
                               111.19, delta=0.1)

    def test_distance_is_symmetric(self):
        there = geometry.haversine_km(*MARINA_GREEN, *ALCATRAZ)
        back = geometry.haversine_km(*ALCATRAZ, *MARINA_GREEN)
        self.assertAlmostEqual(there, back, places=9)


class BearingTests(SimpleTestCase):

    def test_due_north(self):
        self.assertAlmostEqual(
            geometry.initial_bearing_deg(37.0, -122.0, 38.0, -122.0), 0.0, places=6)

    def test_due_east(self):
        self.assertAlmostEqual(
            geometry.initial_bearing_deg(0.0, 0.0, 0.0, 1.0), 90.0, places=6)

    def test_bearing_is_always_in_range(self):
        for target_lon in (-123.0, -122.0, -121.0):
            for target_lat in (36.0, 37.0, 38.0):
                bearing = geometry.initial_bearing_deg(
                    37.0, -122.0, target_lat, target_lon)
                self.assertGreaterEqual(bearing, 0.0)
                self.assertLess(bearing, 360.0)

    def test_golden_gate_bridge_lies_northwest_of_marina_green(self):
        bearing = geometry.initial_bearing_deg(*MARINA_GREEN, *GOLDEN_GATE_BRIDGE)
        self.assertIn(geometry.compass_point(bearing), {'NW', 'WNW', 'NNW'})


class CompassPointTests(SimpleTestCase):

    def test_cardinal_points(self):
        self.assertEqual(geometry.compass_point(0.0), 'N')
        self.assertEqual(geometry.compass_point(90.0), 'E')
        self.assertEqual(geometry.compass_point(180.0), 'S')
        self.assertEqual(geometry.compass_point(270.0), 'W')

    def test_wraps_around_north(self):
        self.assertEqual(geometry.compass_point(359.0), 'N')
        self.assertEqual(geometry.compass_point(360.0), 'N')


class HorizonTests(SimpleTestCase):

    def test_sea_level_observer_has_no_horizon(self):
        self.assertEqual(geometry.horizon_distance_km(0.0), 0.0)

    def test_negative_height_is_clamped(self):
        self.assertEqual(geometry.horizon_distance_km(-5.0), 0.0)

    def test_standing_adult_sees_about_four_and_a_half_km(self):
        self.assertAlmostEqual(geometry.horizon_distance_km(1.6), 4.5, delta=0.1)

    def test_mutual_horizons_add(self):
        combined = geometry.max_sight_distance_km(1.6, 227.0)
        self.assertAlmostEqual(
            combined,
            geometry.horizon_distance_km(1.6) + geometry.horizon_distance_km(227.0),
            places=9)


class ViewArcTests(SimpleTestCase):

    def test_bearing_inside_arc(self):
        self.assertTrue(geometry.is_within_arc(10.0, 0.0, 180.0))

    def test_bearing_behind_observer(self):
        self.assertFalse(geometry.is_within_arc(180.0, 0.0, 180.0))

    def test_arc_wraps_across_north(self):
        # Facing north with a 180 degree arc spans 270 through 90.
        self.assertTrue(geometry.is_within_arc(300.0, 0.0, 180.0))
        self.assertTrue(geometry.is_within_arc(60.0, 0.0, 180.0))
        self.assertFalse(geometry.is_within_arc(200.0, 0.0, 180.0))

    def test_full_circle_accepts_everything(self):
        for bearing in (0.0, 90.0, 180.0, 270.0, 359.9):
            self.assertTrue(geometry.is_within_arc(bearing, 0.0, 360.0))

    def test_angular_difference_never_exceeds_180(self):
        self.assertEqual(geometry.angular_difference_deg(350.0, 10.0), 20.0)
        self.assertEqual(geometry.angular_difference_deg(10.0, 350.0), 20.0)


def _viewpoint(**overrides):
    defaults = dict(
        name='Test Viewpoint', slug='test-viewpoint',
        latitude=MARINA_GREEN[0], longitude=MARINA_GREEN[1],
        eye_elevation_m=4.6, facing_bearing_deg=0.0, field_of_view_deg=180.0,
    )
    defaults.update(overrides)
    return Viewpoint(**defaults)


def _landmark(**overrides):
    defaults = dict(
        name='Test Landmark', slug='test-landmark',
        latitude=GOLDEN_GATE_BRIDGE[0], longitude=GOLDEN_GATE_BRIDGE[1],
        height_m=227.0,
    )
    defaults.update(overrides)
    return Landmark(**defaults)


class SightLineTests(SimpleTestCase):
    """Exercises the service against unsaved instances — no database needed."""

    def test_nearby_landmark_ahead_is_visible(self):
        line = visibility.sight_line(_viewpoint(), _landmark())
        self.assertTrue(line.is_visible)
        self.assertIsNone(line.blocked_reason)

    def test_landmark_behind_the_observer_is_blocked(self):
        # Sutro Tower sits south of the Marina; a north-facing viewpoint
        # cannot see it even though it is tall and close.
        sutro = _landmark(name='Sutro Tower', slug='sutro-tower',
                          latitude=37.7552, longitude=-122.4528, height_m=552.0)
        line = visibility.sight_line(_viewpoint(), sutro)
        self.assertFalse(line.is_visible)
        self.assertEqual(line.blocked_reason, visibility.BLOCKED_OUTSIDE_VIEW)

    def test_the_same_landmark_is_visible_with_an_all_round_outlook(self):
        sutro = _landmark(name='Sutro Tower', slug='sutro-tower',
                          latitude=37.7552, longitude=-122.4528, height_m=552.0)
        line = visibility.sight_line(_viewpoint(field_of_view_deg=360.0), sutro)
        self.assertTrue(line.is_visible)

    def test_distant_low_landmark_falls_below_the_horizon(self):
        # Point Reyes lighthouse: in view to the northwest, but far beyond the
        # combined horizon of a low viewpoint and an 81m headland.
        point_reyes = _landmark(name='Point Reyes', slug='point-reyes',
                                latitude=37.9958, longitude=-123.0217, height_m=81.0)
        line = visibility.sight_line(_viewpoint(), point_reyes)
        self.assertTrue(line.within_view_arc)
        self.assertFalse(line.above_horizon)
        self.assertEqual(line.blocked_reason, visibility.BLOCKED_BELOW_HORIZON)
        self.assertLess(line.horizon_margin_km, 0.0)

    def test_raising_the_observer_extends_the_horizon(self):
        far = _landmark(name='Far', slug='far',
                        latitude=37.9958, longitude=-123.0217, height_m=81.0)
        low = visibility.sight_line(_viewpoint(eye_elevation_m=4.6), far)
        high = visibility.sight_line(_viewpoint(eye_elevation_m=200.0), far)
        self.assertGreater(high.horizon_limit_km, low.horizon_limit_km)

    def test_sight_lines_are_sorted_nearest_first(self):
        landmarks = [
            _landmark(name='Far', slug='far', latitude=37.9296,
                      longitude=-122.5797, height_m=784.0),
            _landmark(name='Near', slug='near', latitude=37.8106,
                      longitude=-122.4470, height_m=10.0),
        ]
        lines = visibility.sight_lines(_viewpoint(), landmarks)
        self.assertEqual([line.landmark.name for line in lines], ['Near', 'Far'])

    def test_visible_landmarks_filters_blocked_ones(self):
        landmarks = [
            _landmark(),  # ahead and close
            _landmark(name='Sutro Tower', slug='sutro-tower', latitude=37.7552,
                      longitude=-122.4528, height_m=552.0),  # behind
        ]
        visible = visibility.visible_landmarks(_viewpoint(), landmarks)
        self.assertEqual([line.landmark.name for line in visible], ['Test Landmark'])
