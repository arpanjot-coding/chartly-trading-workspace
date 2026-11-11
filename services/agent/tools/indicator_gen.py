"""Agent tools that list and save custom chart indicators.

The indicator equivalent of openscript_gen: a model writes one
single-file plain-JavaScript indicator (following the chart-indicator
skill), shows it to the trader, and — after their confirmation —
``save_custom_indicator`` puts it in strategies/indicators/ through
``services.custom_indicator_store``, the one write path shared with
the Settings manager and the MCP server.

Two limits the result wording protects, mirroring the OpenScript tool:

* Nothing here compiles or runs JavaScript. The store checks the
  contract *shape* (name, size, default export + registerIndicator);
  descriptor/calc validation happens when the trader presses Validate
  in Settings > Custom Indicators or opens the chart's indicator
  picker, which reports load errors in its Custom section. The result
  therefore always carries ``validated: false`` so the model cannot
  tell the trader the indicator works when only the save did.
* A save never overwrites. An existing name comes back as a refusal
  the model must surface; replacing takes ``replace=True``, which the
  model passes only when the user asked to replace that file.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from services import custom_indicator_store
from services.agent.prompts import wrap_tool_result
from services.agent.tools.base import (
    SERVICE_BUSY_MESSAGE,
    ChartlyToolkit,
    _HubTimeout,
    call_service,
    invalid_argument,
    strip_code_fence,
)
from utils import real_threading
from utils.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - typing only
    from services.agent.tools import ToolContext

logger = get_logger(__name__)

_DISPLAY_TIMEZONE = ZoneInfo("Asia/Kolkata")

NEXT_STEP = (
    "{file} is saved but NOT validated: nothing here runs JavaScript. Tell the "
    "trader to open Settings > Custom Indicators, select {file} and press "
    "Validate, then open the chart's Indicators picker — it is under Custom. "
    "The picker re-reads the folder when opened, so no restart is needed. "
    "Never say the indicator works until the trader confirms it draws."
)


class CustomIndicatorToolkit(ChartlyToolkit):
    """List and save custom chart indicators in strategies/indicators/."""

    def __init__(self, context: ToolContext) -> None:
        """Register the two tools with agno.

        Args:
            context: The run's tool context.
        """
        super().__init__(
            context,
            name="indicator_gen",
            tools=[self.list_custom_indicators, self.save_custom_indicator],
            requires_confirmation_tools=["save_custom_indicator"],
        )

    # -- helpers ---------------------------------------------------------------

    def _result(self, tool, payload) -> str:
        """Serialise a payload and label it as data for the model."""
        return wrap_tool_result(tool, self.to_json(payload))

    # -- tools ---------------------------------------------------------------

    def list_custom_indicators(self) -> str:
        """List the custom indicators already stored in strategies/indicators/.

        Call this before saving, so a new indicator does not take the name
        of one the trader already has, and so you can tell them what exists.
        Reading only; nothing is written.

        Returns:
            JSON with an ``indicators`` array. Each entry has ``file``,
            ``bytes`` and ``modified`` (ISO 8601, IST). Sorted by name,
            capped at 200 entries.
        """
        tool = "list_custom_indicators"
        try:
            entries = custom_indicator_store.list_indicators()
        except OSError:
            logger.exception("Could not list the custom indicators folder")
            return self._result(
                tool,
                {
                    "ok": False,
                    "indicators": [],
                    "error": (
                        "The indicators folder could not be listed. Do not guess "
                        "what is saved; tell the trader so they can retry."
                    ),
                },
            )
        return self._result(
            tool,
            {
                "ok": True,
                "count": len(entries),
                "indicators": [
                    {
                        "file": entry["file"],
                        "bytes": entry["bytes"],
                        "modified": datetime.fromtimestamp(
                            entry["mtime"], tz=_DISPLAY_TIMEZONE
                        ).isoformat(),
                    }
                    for entry in entries
                ],
            },
        )

    def save_custom_indicator(
        self, filename: str, source: str, replace: bool = False
    ) -> str:
        """Save ONE complete custom chart indicator as strategies/indicators/<name>.js.

        Read the chart-indicator skill first, copy type and field names from
        it verbatim, show the trader the full source and one or two worked
        numbers, and only then call this. It writes the file; it NEVER
        validates or runs the JavaScript, so do not tell the trader the
        indicator works until they confirm it draws.

        Args:
            filename: File name, with or without the .js suffix (added if
                omitted). Letters, digits, dot, dash or underscore, starting
                with a letter or digit, at most 64 characters before .js
                (e.g. session_vwap_bands.js).
            source: The complete plain-JavaScript source — the whole file,
                default-exporting the factory that calls registerIndicator,
                no imports, no TypeScript. Up to 256 kB.
            replace: Pass true ONLY when the user has asked to replace that
                exact file. Left false, an existing name is refused and comes
                back as an error — never silently overwrite an indicator the
                trader already has.

        Returns:
            JSON with ``saved``, ``file``, ``bytes``, ``lines``, ``replaced``,
            ``validated`` (always false) and ``next_step``, what the trader
            does in Settings / the chart picker.
        """
        tool = "save_custom_indicator"
        try:
            name = custom_indicator_store.normalised_name(filename)
        except custom_indicator_store.IndicatorInvalid as exc:
            invalid_argument("filename", str(exc))
        if not isinstance(source, str):
            invalid_argument("source", "must be the complete indicator source text")
        text = strip_code_fence(source)
        try:
            custom_indicator_store.validate_source(text)
        except custom_indicator_store.IndicatorInvalid as exc:
            invalid_argument("source", str(exc))
        encoded = text.encode("utf-8")
        allow_replace = replace is True

        audit_args = {"filename": name, "source_bytes": len(encoded), "replace": allow_replace}
        conflict: custom_indicator_store.IndicatorConflict | None = None
        with self.audited(tool, audit_args) as audit:
            try:
                saved = call_service(
                    custom_indicator_store.write_indicator,
                    name,
                    text,
                    allow_replace,
                )
            except custom_indicator_store.IndicatorConflict as exc:
                audit.record(ok=False, response={"status": "refused", "reason": "exists"})
                conflict = exc
            except (real_threading.HubQueueFull, _HubTimeout):
                logger.warning("Agent indicator save of %s could not run in time", name)
                audit.record(ok=False, response={"status": "error", "reason": "busy"})
                return self._result(
                    tool,
                    {
                        "ok": False,
                        "saved": False,
                        "error": SERVICE_BUSY_MESSAGE.format(label="Saving the indicator"),
                    },
                )
            except OSError:
                logger.exception("Could not save the agent's indicator %s", name)
                audit.record(ok=False, response={"status": "error", "reason": "write failed"})
                return self._result(
                    tool,
                    {
                        "ok": False,
                        "saved": False,
                        "error": (
                            f"{name} could not be written to the indicators folder. "
                            "This is a problem on the server, not with the indicator; "
                            "tell the operator rather than calling again."
                        ),
                    },
                )

            if conflict is None:
                payload = {
                    "ok": True,
                    "saved": True,
                    "file": saved.file,
                    "bytes": saved.bytes,
                    "lines": text.count("\n") + (0 if text.endswith("\n") else 1),
                    "replaced": saved.replaced,
                    "backup": f"{saved.file}.bak" if saved.replaced else None,
                    "validated": False,
                    "next_step": NEXT_STEP.format(file=saved.file),
                }
                audit.record(ok=True, response={"file": saved.file, "replaced": saved.replaced})
                return self._result(tool, payload)

        return self._result(
            tool,
            {
                "ok": False,
                "saved": False,
                "error": (
                    f"{name} already exists and was NOT overwritten. Show the trader "
                    "this name and ask whether to replace it (call again with "
                    "replace=true) or save under a new file name."
                ),
            },
        )
