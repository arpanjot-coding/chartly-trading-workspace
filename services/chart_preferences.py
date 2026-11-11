"""Allowlisted original chart preferences inside a scoped data-only envelope."""

import json
import re

CHART_PREFERENCES_KEY = re.compile(r"chartly\.chart\.preferences\.v1:[A-Za-z0-9_%:~.-]{1,240}\Z")
GLOBAL = frozenset(
    (
        "oa-trading-layout",
        "oa-trading-sync",
        "oa-trading-panel",
        "oa-trading-armed",
        "oa-trading-rail-folded",
        "oa-trading-layout-sizes",
        "oa-trading-dock",
        "oa-trading-dock-height",
    )
)
PANE = re.compile(
    r"oa-trading-p(?:[0-9]|1[0-5])-(?:alerts|chartsettings|comparisons|ctype|grid|indicators|interval|magnet-mode|magnet|panes-folded|product|range|stay|symbol|transforms|vol|draw|draw-scoped|draw:[A-Za-z0-9_%:~.!'()*+-]{1,400})\Z"
)


def chart_preference_name(key):
    return isinstance(key, str) and (key in GLOBAL or bool(PANE.fullmatch(key)))


def validate_chart_preferences(raw):
    if not isinstance(raw, str) or len(raw) > 2 * 1024 * 1024:
        raise ValueError("chart.invalid_preferences")
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError) as error:
        raise ValueError("chart.invalid_preferences") from error
    if (
        not isinstance(value, dict)
        or len(value) > 2048
        or any(
            not chart_preference_name(key) or not isinstance(item, str) or len(item) > 1024 * 1024
            for key, item in value.items()
        )
    ):
        raise ValueError("chart.invalid_preferences")
    return value
