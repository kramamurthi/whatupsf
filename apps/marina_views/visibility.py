"""The domain question: from this viewpoint, what can I see?

A sight line is a pure function of two locations and their heights, so it is
computed on demand rather than stored. Persisting it would mean maintaining a
cache that has to be invalidated whenever a coordinate or elevation is edited,
in exchange for avoiding arithmetic that costs microseconds.

Milestone 1 applies two rules, in the order a person would:

    1. Is the landmark in the direction I am facing?
    2. Is it near enough to be above the horizon?

Terrain and buildings between the two points are *not* modelled yet, so a
sight line reported here is "geometrically unobstructed", not "guaranteed
visible". `SightLine.is_visible` should be read with that caveat.
"""

from dataclasses import dataclass

from . import geometry

#: Ordered so that the first failing rule is the one reported to the user.
BLOCKED_OUTSIDE_VIEW = 'outside field of view'
BLOCKED_BELOW_HORIZON = 'below horizon'


@dataclass(frozen=True)
class SightLine:
    """The computed relationship between one viewpoint and one landmark."""

    landmark: object
    distance_km: float
    bearing_deg: float
    compass: str
    horizon_limit_km: float
    within_view_arc: bool

    @property
    def above_horizon(self):
        return self.distance_km <= self.horizon_limit_km

    @property
    def is_visible(self):
        return self.within_view_arc and self.above_horizon

    @property
    def blocked_reason(self):
        """Why this landmark cannot be seen, or None if it can."""
        if not self.within_view_arc:
            return BLOCKED_OUTSIDE_VIEW
        if not self.above_horizon:
            return BLOCKED_BELOW_HORIZON
        return None

    @property
    def horizon_margin_km(self):
        """Spare distance before the landmark would drop below the horizon.

        Negative when it already has. Useful for showing *how* marginal a
        long-range sighting is.
        """
        return self.horizon_limit_km - self.distance_km


def sight_line(viewpoint, landmark):
    """Compute the sight line from `viewpoint` to `landmark`."""
    distance_km = geometry.haversine_km(
        viewpoint.latitude, viewpoint.longitude,
        landmark.latitude, landmark.longitude,
    )
    bearing_deg = geometry.initial_bearing_deg(
        viewpoint.latitude, viewpoint.longitude,
        landmark.latitude, landmark.longitude,
    )
    return SightLine(
        landmark=landmark,
        distance_km=distance_km,
        bearing_deg=bearing_deg,
        compass=geometry.compass_point(bearing_deg),
        horizon_limit_km=geometry.max_sight_distance_km(
            viewpoint.eye_elevation_m, landmark.height_m,
        ),
        within_view_arc=geometry.is_within_arc(
            bearing_deg,
            viewpoint.facing_bearing_deg,
            viewpoint.field_of_view_deg,
        ),
    )


def sight_lines(viewpoint, landmarks=None):
    """Sight lines from `viewpoint` to every landmark, nearest first.

    `landmarks` may be any iterable of landmark-shaped objects. Passing it
    explicitly keeps this function testable without a database; omitting it
    falls back to every active landmark.
    """
    if landmarks is None:
        from .models import Landmark
        landmarks = Landmark.objects.filter(is_active=True)

    lines = [sight_line(viewpoint, landmark) for landmark in landmarks]
    lines.sort(key=lambda line: line.distance_km)
    return lines


def visible_landmarks(viewpoint, landmarks=None):
    """Only the sight lines that are not blocked, nearest first."""
    return [line for line in sight_lines(viewpoint, landmarks) if line.is_visible]
