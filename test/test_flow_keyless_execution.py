"""Keyless local-only automation: classification of broker-reaching nodes.

A personal-mode user has no legacy Developer API key. Workflows whose
nodes never reach the broker client must still run; anything that would
touch the client — including unrecognised node types — keeps requiring
one (fail-closed).
"""

from services.flow_executor_service import BROKER_NODE_TYPES, workflow_needs_api_key


def node(node_type):
    return {"id": f"{node_type}-1", "type": node_type, "data": {}}


def test_local_only_graph_needs_no_key():
    graph = [node("start"), node("log"), node("delay"), node("mathExpression")]
    assert workflow_needs_api_key(graph) is False
    assert workflow_needs_api_key([node("webhookTrigger"), node("httpRequest")]) is False
    assert workflow_needs_api_key([]) is False
    assert workflow_needs_api_key(None) is False


def test_broker_nodes_need_a_key():
    for node_type in ("placeOrder", "getQuote", "history", "positionBook", "subscribeLtp"):
        assert node_type in BROKER_NODE_TYPES
        assert workflow_needs_api_key([node("start"), node(node_type)]) is True


def test_broker_polling_triggers_need_a_key():
    assert workflow_needs_api_key([node("priceAlert"), node("log")]) is True
    assert workflow_needs_api_key([node("orderUpdateTrigger"), node("log")]) is True


def test_unknown_node_type_fails_closed():
    assert workflow_needs_api_key([node("start"), node("someFutureNode")]) is True
    assert workflow_needs_api_key([{"id": "x", "data": {}}]) is True
    assert workflow_needs_api_key(["not-a-node"]) is True
