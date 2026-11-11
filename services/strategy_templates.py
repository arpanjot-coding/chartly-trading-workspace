"""Original Strategy Builder starter templates (P20-T05).

Small, original chartly-rules-v1 documents used to seed new projects.
They are examples for learning the builder, not trading advice and not
copies of any third-party script.
"""

from __future__ import annotations

from copy import deepcopy

from services.strategy_artifacts import validate_source_document

_POLICY = {"warmupBars": 14, "barCloseOnly": True, "missingData": "skip-bar"}

TEMPLATES = [
    {
        "id": "template-rsi-indicator",
        "name": "RSI momentum (starter)",
        "kind": "indicator",
        "description": "Relative strength of the chosen source with an adjustable length.",
        "document": {
            "format": "chartly-rules-v1",
            "kind": "indicator",
            "inputs": [
                {"name": "length", "type": "integer", "default": "14", "min": "2", "max": "200", "unit": "bars"},
                {"name": "source", "type": "source", "default": "close"},
            ],
            "outputs": [{"name": "rsi", "plot": "line"}],
            "policy": dict(_POLICY),
            "rules": [{"op": "rsi", "input": "source", "length": "length", "output": "rsi"}],
        },
    },
    {
        "id": "template-sma-cross-strategy",
        "name": "Moving-average cross (starter)",
        "kind": "strategy",
        "description": "Fast average crossing above the slow average marks a long entry; crossing below marks an exit.",
        "document": {
            "format": "chartly-rules-v1",
            "kind": "strategy",
            "inputs": [
                {"name": "fast_length", "type": "integer", "default": "9", "min": "2", "max": "200", "unit": "bars"},
                {"name": "slow_length", "type": "integer", "default": "21", "min": "3", "max": "500", "unit": "bars"},
                {"name": "source", "type": "source", "default": "close"},
            ],
            "outputs": [
                {"name": "fast", "plot": "line"},
                {"name": "slow", "plot": "line"},
                {"name": "entry", "plot": "marker"},
                {"name": "exit", "plot": "marker"},
            ],
            "policy": {"warmupBars": 21, "barCloseOnly": True, "missingData": "skip-bar"},
            "rules": [
                {"op": "sma", "input": "source", "length": "fast_length", "output": "fast"},
                {"op": "sma", "input": "source", "length": "slow_length", "output": "slow"},
                {"op": "cross_over", "left": "fast", "right": "slow", "output": "entry"},
                {"op": "cross_under", "left": "fast", "right": "slow", "output": "exit"},
            ],
        },
    },
    {
        "id": "template-oversold-recovery-strategy",
        "name": "Oversold recovery (starter)",
        "kind": "strategy",
        "description": "RSI crossing back above a recovery threshold after weak momentum marks a long entry.",
        "document": {
            "format": "chartly-rules-v1",
            "kind": "strategy",
            "inputs": [
                {"name": "length", "type": "integer", "default": "14", "min": "2", "max": "200", "unit": "bars"},
                {"name": "recovery_level", "type": "decimal", "default": "30", "min": "1", "max": "99"},
                {"name": "source", "type": "source", "default": "close"},
            ],
            "outputs": [
                {"name": "rsi", "plot": "line"},
                {"name": "entry", "plot": "marker"},
            ],
            "policy": dict(_POLICY),
            "rules": [
                {"op": "rsi", "input": "source", "length": "length", "output": "rsi"},
                {"op": "cross_over", "left": "rsi", "right": "recovery_level", "output": "entry"},
            ],
        },
    },
]


def list_templates():
    return [
        {key: deepcopy(value) for key, value in template.items() if key != "document"}
        | {"language": "chartly-rules-v1"}
        for template in TEMPLATES
    ]


def template_document(template_id):
    for template in TEMPLATES:
        if template["id"] == template_id:
            document = deepcopy(template["document"])
            issues = validate_source_document(document, for_revision=True)
            if issues:  # pragma: no cover - guarded by tests
                raise AssertionError(issues)
            return document, template["name"], template["kind"]
    return None
