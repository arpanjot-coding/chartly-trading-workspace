# websocket_proxy/__init__.py

import logging

from .base_adapter import (
    BaseBrokerWebSocketAdapter,
    ENABLE_CONNECTION_POOLING,
    MAX_SYMBOLS_PER_WEBSOCKET,
    MAX_WEBSOCKET_CONNECTIONS,
)
from .broker_factory import (
    cleanup_all_pools,
    create_broker_adapter,
    get_pool_stats,
    get_resource_health,
    register_adapter,
)
from .connection_manager import (
    ConnectionPool,
    SharedZmqPublisher,
    get_max_symbols_per_websocket,
    get_max_websocket_connections,
)
from .server import WebSocketProxy
from .server import main as websocket_main

# Set up logger
logger = logging.getLogger(__name__)
# Indian broker streaming adapters removed 2026-11-04 (product scope change).
# The registry stays empty until discussed-platform streaming adapters land
# (crypto venue streams live in services/, e.g. kraken_streams.py).

# AliceBlue adapter will be registered dynamically when first used

__all__ = [
    # Core classes
    "WebSocketProxy",
    "websocket_main",
    "register_adapter",
    "create_broker_adapter",
    # Base adapter (for cleanup utilities)
    "BaseBrokerWebSocketAdapter",
    # Connection pooling (multi-websocket support)
    "ConnectionPool",
    "SharedZmqPublisher",
    "get_pool_stats",
    "get_resource_health",
    "cleanup_all_pools",
    "get_max_symbols_per_websocket",
    "get_max_websocket_connections",
    # Configuration constants
    "MAX_SYMBOLS_PER_WEBSOCKET",
    "MAX_WEBSOCKET_CONNECTIONS",
    "ENABLE_CONNECTION_POOLING",
    # Broker adapters
    "AngelWebSocketAdapter",
    "ZerodhaWebSocketAdapter",
    "DhanWebSocketAdapter",
    "FlattradeWebSocketAdapter",
    "ShoonyaWebSocketAdapter",
    "TradeSmartWebSocketAdapter",
    "IbullsWebSocketAdapter",
    "CompositedgeWebSocketAdapter",
    "FivepaisaWebSocketAdapter",
    "FivepaisaXTSWebSocketAdapter",
    "IiflWebSocketAdapter",
    "IiflcapitalWebSocketAdapter",
    "JainamWebSocketAdapter",
    "TrustlineWebSocketAdapter",
    "WisdomWebSocketAdapter",
    "UpstoxWebSocketAdapter",
    "KotakWebSocketAdapter",
    "FyersWebSocketAdapter",
    "DefinedgeWebSocketAdapter",
    "PaytmWebSocketAdapter",
    "IndmoneyWebSocketAdapter",
    "MstockWebSocketAdapter",
    "MotilalWebSocketAdapter",
    "JainamXTSWebSocketAdapter",
    "SamcoWebSocketAdapter",
    "PocketfulWebSocketAdapter",
    "NubraWebSocketAdapter",
    "RMoneyWebSocketAdapter",
    "ArrowWebSocketAdapter",
    "RupeezyWebSocketAdapter",
    "HDFCSkyWebSocketAdapter",
    "HDFCSecuritiesWebSocketAdapter",
]
