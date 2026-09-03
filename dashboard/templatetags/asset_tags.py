"""Cache-busting static URLs.

`runserver` serves static files with a `Last-Modified` header but no
`Cache-Control` and no `ETag`, so browsers fall back to heuristic caching and
happily reuse a stale copy on an ordinary refresh. ES modules make it worse:
the whole import graph behind `<script type="module">` plus an import map is
cached hard, so edits to a module can keep replaying the old code until a
manual hard-reload.

`{% static_v %}` stamps each URL with the file's modification time, so any
edit produces a new URL and the browser is obliged to refetch. Falls back to
the plain URL if the file cannot be located, so nothing breaks under
collectstatic or a missing asset.
"""

import os

from django import template
from django.contrib.staticfiles import finders
from django.templatetags.static import static

register = template.Library()


@register.simple_tag
def static_v(path):
    url = static(path)

    try:
        absolute = finders.find(path)
    except Exception:
        absolute = None

    if absolute and os.path.exists(absolute):
        stamp = int(os.path.getmtime(absolute))
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}v={stamp}"

    return url
