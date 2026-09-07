"""URL routes for the AQUA NEST UI.

Ponds is the home page and Control runs the equipment. The other three
primary sections are placeholders for now. `/overview/` keeps the earlier
farm-wide dashboard reachable - it is not a primary section any more, but its
panels are worth cannibalising when Intelligence gets built.
"""

from django.urls import path

from . import views

app_name = "dashboard"

urlpatterns = [
    path("", views.ponds, name="ponds"),
    path("intelligence/", views.placeholder, {"key": "intelligence"}, name="intelligence"),
    path("control/", views.control, name="control"),
    path("nest/", views.placeholder, {"key": "nest"}, name="nest"),
    path("life/", views.placeholder, {"key": "life"}, name="life"),

    # Parked: the previous farm-wide dashboard, no longer in the sidebar.
    path("overview/", views.dashboard, name="overview"),
]
