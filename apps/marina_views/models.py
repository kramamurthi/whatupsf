"""Persisted facts for the Marina Views application.

These models store *where things are*, nothing more. Whether one can be seen
from another is derived on demand in `visibility.py` — see the note there on
why that is not a stored relationship.

Unlike the legacy tables in `apps.events`, these are ordinary managed Django
models with real migrations. They intentionally have no foreign keys to
`auth` or `contenttypes`, so `migrate marina_views` can be applied on its own
against the existing database.
"""

from django.db import models


class Landmark(models.Model):
    """Something one might be able to see: a bridge, a peak, a tower."""

    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    latitude = models.FloatField()
    longitude = models.FloatField()

    height_m = models.FloatField(
        default=0.0,
        help_text="Height of the highest visible point above mean sea level, "
                  "in metres. For a bridge this is the tower top; for a hill, "
                  "the summit.",
    )

    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return self.name


class Viewpoint(models.Model):
    """A place someone stands and looks out from."""

    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    latitude = models.FloatField()
    longitude = models.FloatField()

    eye_elevation_m = models.FloatField(
        default=1.6,
        help_text="Observer's eye height above mean sea level, in metres. "
                  "Ground elevation plus roughly 1.6m for a standing adult.",
    )

    facing_bearing_deg = models.FloatField(
        default=0.0,
        help_text="Direction the viewpoint looks toward, in degrees clockwise "
                  "from true north (0 = north, 90 = east).",
    )
    field_of_view_deg = models.FloatField(
        default=180.0,
        help_text="Width of the open view arc, centred on the facing bearing. "
                  "Use 360 for an unobstructed all-round outlook.",
    )

    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return self.name
