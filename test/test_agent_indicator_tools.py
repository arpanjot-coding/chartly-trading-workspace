"""The agent's custom-indicator save tool, the shared store, and its skill.

Pins the same discipline as the OpenScript tool: one write path, never
overwrite without an explicit replace, and a result that never lets the
model claim the JavaScript was validated when nothing here runs it.
Every test points the store at a temporary folder.
"""

from __future__ import annotations

import json

import pytest

pytest.importorskip("agno.tools", reason="the agent module needs agno")

from services import custom_indicator_store  # noqa: E402
from services.agent.skills import registry as skill_registry  # noqa: E402
from services.agent.tools import (  # noqa: E402
    SURFACE_CHART,
    SURFACE_CHAT,
    SURFACE_VOICE,
    ToolContext,
    select_specs,
)
from services.agent.tools.base import ChartlyToolkit  # noqa: E402
from services.agent.tools.indicator_gen import CustomIndicatorToolkit  # noqa: E402

SOURCE = (
    "export default function ({ registerIndicator }) {\n"
    "  registerIndicator({ id: 'x', name: 'X', calc: (bars) => ({}) })\n"
    "}\n"
)


def _payload(block: str) -> dict:
    lines = block.strip().splitlines()
    return json.loads("\n".join(lines[1:-1]))


@pytest.fixture
def folder(tmp_path, monkeypatch):
    directory = tmp_path / "indicators"
    monkeypatch.setattr(custom_indicator_store, "indicator_dir", lambda: directory)
    return directory


@pytest.fixture
def audits(monkeypatch):
    rows: list[dict] = []

    def record(self, phase, **row):
        rows.append({"phase": phase, **row})
        return None

    monkeypatch.setattr(ChartlyToolkit, "_write_audit", record)
    return rows


@pytest.fixture
def toolkit(folder, audits):
    return CustomIndicatorToolkit(
        ToolContext(api_key="k", surface=SURFACE_CHAT, conversation_id=0)
    )


def test_save_roundtrip_and_validated_is_always_false(folder, toolkit, audits):
    payload = _payload(toolkit.save_custom_indicator("my_sma", SOURCE))
    assert payload["ok"] is True and payload["saved"] is True
    assert payload["file"] == "my_sma.js" and payload["validated"] is False
    # The tool fence-strips its input, so the file is SOURCE minus the final newline.
    assert (folder / "my_sma.js").read_text(encoding="utf-8") == SOURCE.rstrip("\n")
    listing = _payload(toolkit.list_custom_indicators())
    assert [row["file"] for row in listing["indicators"]] == ["my_sma.js"]
    assert audits, "the save must leave an audit row"


def test_save_never_overwrites_without_replace(folder, toolkit):
    toolkit.save_custom_indicator("my_sma", SOURCE)
    refused = _payload(toolkit.save_custom_indicator("my_sma", SOURCE + "// v2\n"))
    assert refused["ok"] is False and refused["saved"] is False
    assert (folder / "my_sma.js").read_text(encoding="utf-8") == SOURCE.rstrip("\n")
    replaced = _payload(
        toolkit.save_custom_indicator("my_sma", SOURCE + "// v2\n", replace=True)
    )
    assert replaced["replaced"] is True
    assert (folder / "my_sma.js.bak").exists()


def test_toolkit_registered_on_chat_and_chart_not_voice():
    for surface in (SURFACE_CHAT, SURFACE_CHART):
        keys = {spec.key for spec in select_specs(ToolContext(api_key="k", surface=surface))}
        assert "indicator_gen" in keys
    keys = {spec.key for spec in select_specs(ToolContext(api_key="k", surface=SURFACE_VOICE))}
    assert "indicator_gen" not in keys


def test_chart_indicator_skill_is_offered_with_honest_notes():
    names = {spec.name for spec in skill_registry.skills_for_surface("chat")}
    assert "chart-indicator" in names
    spec = next(s for s in skill_registry.skills_for_surface("chart") if s.name == "chart-indicator")
    assert "save_custom_indicator" in spec.agent_notes
    assert "never claim an indicator is" in spec.agent_notes
