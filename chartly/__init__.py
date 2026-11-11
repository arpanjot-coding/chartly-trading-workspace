"""Chartly Python SDK.

Client package for strategies and scripts::

    from chartly import api, ta
    client = api(api_key="...", host="http://127.0.0.1:5000")

This package re-exports the underlying published client library so all
Chartly user code imports from ``chartly`` only.
"""

import importlib as _importlib

_sdk = _importlib.import_module("openalgo")

api = _sdk.api
ta = getattr(_sdk, "ta", None)
Strategy = getattr(_sdk, "Strategy", None)

__all__ = ["api", "ta", "Strategy"]


def __getattr__(name):
    return getattr(_sdk, name)
