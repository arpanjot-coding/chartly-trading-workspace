"""Telegram and WhatsApp bots are no longer Chartly product surfaces.

The profile-first product keeps broker/prop communication inside Trading
Profiles and Flow. These checks pin the old bot REST namespaces and order-event
subscribers out of the runtime so they cannot drift back in as hidden routes.
"""

import importlib.util
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_messaging_bot_modules_are_removed():
    for module_name in (
        "blueprints.telegram",
        "blueprints.whatsapp",
        "database.telegram_db",
        "database.whatsapp_db",
        "restx_api.telegram_bot",
        "restx_api.whatsapp_bot",
        "services.telegram_alert_service",
        "services.telegram_bot_service",
        "services.whatsapp_alert_service",
        "services.whatsapp_bot_service",
        "subscribers.telegram_subscriber",
        "subscribers.whatsapp_subscriber",
    ):
        assert importlib.util.find_spec(module_name) is None, module_name


def test_restx_namespaces_exclude_messaging_bots():
    from restx_api import api

    paths = {getattr(namespace, "path", "") for namespace in api.namespaces}
    names = {getattr(namespace, "name", "") for namespace in api.namespaces}
    assert "/telegram" not in paths
    assert "/whatsapp" not in paths
    assert "telegram" not in names
    assert "whatsapp" not in names


def test_event_subscribers_exclude_messaging_bots():
    import subscribers
    from utils.event_bus import bus

    subscribers.register_all()
    handler_names = {
        subscription.name
        for subscriptions in bus._subscribers.values()
        for subscription in subscriptions
    }
    assert not any(name.startswith("telegram:") for name in handler_names)
    assert not any(name.startswith("whatsapp:") for name in handler_names)
