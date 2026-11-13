"""Root URL configuration for the AQUA NEST project."""

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from dashboard import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/login/", auth_views.LoginView.as_view(
        template_name="dashboard/auth.html",
        redirect_authenticated_user=True,
        extra_context={"mode": "login"},
    ), name="login"),
    # Django's LogoutView only accepts POST, so Sign out is a form.
    path("accounts/logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("accounts/signup/", views.signup, name="signup"),
    path("accounts/settings/", views.account, name="account"),
    path("", include("dashboard.urls")),
]
