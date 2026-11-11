"""The base release omits legacy broker packs. An installed pack must pass its checks."""

from pathlib import Path

import pytest

_BROKERS = Path(__file__).resolve().parents[1] / "broker"


def pack_present(broker: str) -> bool:
    return (_BROKERS / broker).is_dir()


def require_pack(broker: str) -> None:
    if not pack_present(broker):
        pytest.skip(f"Optional broker pack {broker} is absent")


def module_available(module: str) -> bool:
    prefix, *parts = module.split(".", 2)
    return prefix != "broker" or pack_present(parts[0])
