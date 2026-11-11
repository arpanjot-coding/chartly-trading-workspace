"""Local platform bridge: pairing, sessions, terminals, heartbeat (P09).

The bridge owns *trust* for local terminal connections: one-time
pairing codes, hashed session tokens with scopes, protocol-version
negotiation, heartbeat staleness, bounded command queues and explicit
terminal state (configured -> running -> authenticated). Account
identity is verified through the platform adapter at bind time and
re-checked on every use; a changed login invalidates the binding
instead of silently following the terminal to another account.

Transport is injected (the in-process default serves tests and the
same-machine worker); binding to anything beyond loopback is out of
scope for this module. State is in-memory by design: a bridge restart
requires re-pairing, which is the safe failure mode.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from collections import deque
from datetime import UTC, datetime, timedelta

PROTOCOL_VERSIONS = (1,)
PAIRING_TTL_SECONDS = 300
HEARTBEAT_STALE_SECONDS = 30
MAX_QUEUE = 256
SCOPES = ("read", "history", "demo-order")


class BridgeError(Exception):
    def __init__(self, code, status=409):
        super().__init__(code)
        self.code = code
        self.status = status


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _parse(at):
    return datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(UTC)


def negotiate(client_versions):
    """Pick the highest shared protocol version or refuse explicitly."""
    if not isinstance(client_versions, (list, tuple)) or not client_versions:
        raise BridgeError("bridge.version_missing", 400)
    shared = [v for v in client_versions if v in PROTOCOL_VERSIONS]
    if not shared:
        raise BridgeError("bridge.version_incompatible", 426)
    return max(shared)


class BoundedQueue:
    """FIFO with a hard bound; overflow is an error, never a silent drop."""

    def __init__(self, maximum=MAX_QUEUE):
        self._items = deque()
        self.maximum = maximum

    def push(self, item):
        if len(self._items) >= self.maximum:
            raise BridgeError("bridge.queue_full", 429)
        self._items.append(item)

    def drain(self, limit=64):
        out = []
        while self._items and len(out) < limit:
            out.append(self._items.popleft())
        return out

    def __len__(self):
        return len(self._items)


class PlatformBridge:
    def __init__(self, *, clock):
        self._clock = clock  # () -> canonical instant text
        self._pairings = {}  # code hash -> {scopes, expires}
        self._sessions = {}  # token hash -> session dict
        self._terminals = {}  # terminal id -> terminal dict

    # -- pairing & sessions -------------------------------------------------

    def create_pairing(self, scopes=("read", "history")):
        unknown = [scope for scope in scopes if scope not in SCOPES]
        if unknown or not scopes:
            raise BridgeError("bridge.scope_invalid", 400)
        code = secrets.token_urlsafe(24)
        expires = _parse(self._clock()) + timedelta(seconds=PAIRING_TTL_SECONDS)
        self._pairings[_hash(code)] = {
            "scopes": tuple(scopes),
            "expires": expires,
        }
        return {"pairingCode": code, "expiresInSeconds": PAIRING_TTL_SECONDS}

    def redeem_pairing(self, code, client_versions):
        version = negotiate(client_versions)
        entry = self._pairings.pop(_hash(code), None)  # one-time use
        if entry is None:
            raise BridgeError("bridge.pairing_invalid", 401)
        if _parse(self._clock()) > entry["expires"]:
            raise BridgeError("bridge.pairing_expired", 401)
        token = secrets.token_urlsafe(32)
        session = {
            "id": "bridge-" + _hash(token)[:16],
            "scopes": entry["scopes"],
            "protocolVersion": version,
            "createdAt": self._clock(),
            "lastHeartbeatAt": None,
            "queue": BoundedQueue(),
            "binding": None,  # {terminalId, identityHash, identity}
        }
        self._sessions[_hash(token)] = session
        return {"sessionToken": token, "sessionId": session["id"], "protocolVersion": version}

    def authenticate(self, token, scope=None):
        session = self._sessions.get(_hash(token or ""))
        if session is None:
            raise BridgeError("bridge.session_invalid", 401)
        if scope is not None and scope not in session["scopes"]:
            raise BridgeError("bridge.scope_denied", 403)
        return session

    def revoke(self, token):
        self._sessions.pop(_hash(token or ""), None)

    # -- terminals ------------------------------------------------------------

    def register_terminal(self, terminal_id, platform, path):
        if platform not in {"mt5", "ninjatrader", "ctrader", "mt4"}:
            raise BridgeError("bridge.platform_unsupported", 400)
        if terminal_id in self._terminals:
            raise BridgeError("bridge.terminal_exists", 409)
        self._terminals[terminal_id] = {
            "id": terminal_id,
            "platform": platform,
            "path": path,
            "state": "configured",
            "identity": None,
            "verifiedAt": None,
        }
        return dict(self._terminals[terminal_id])

    def refresh_terminal(self, terminal_id, *, process_running, probe=None):
        """Advance configured -> running -> authenticated with evidence.

        `probe` returns the platform-verified identity dict (or raises).
        A terminal whose process stopped falls back to `configured` and
        loses its authenticated identity.
        """
        terminal = self._terminals.get(terminal_id)
        if terminal is None:
            raise BridgeError("bridge.terminal_unknown", 404)
        if not process_running:
            terminal["state"] = "configured"
            terminal["identity"] = None
            return dict(terminal)
        terminal["state"] = "running"
        if probe is not None:
            identity = probe()
            terminal["identity"] = identity
            terminal["state"] = "authenticated"
            terminal["verifiedAt"] = self._clock()
        return dict(terminal)

    def bind_account(self, token, terminal_id):
        """Bind a session to a terminal's *verified* identity (T03/T07)."""
        session = self.authenticate(token, "read")
        terminal = self._terminals.get(terminal_id)
        if terminal is None or terminal["state"] != "authenticated":
            raise BridgeError("bridge.terminal_not_authenticated", 409)
        session["binding"] = {
            "terminalId": terminal_id,
            "identityHash": _hash(repr(sorted(terminal["identity"].items()))),
            "identity": dict(terminal["identity"]),
            "boundAt": self._clock(),
        }
        return dict(session["binding"]["identity"])

    def assert_binding(self, token, current_identity):
        """Refuse if the terminal's account changed since binding."""
        session = self.authenticate(token, "read")
        binding = session["binding"]
        if binding is None:
            raise BridgeError("bridge.not_bound", 409)
        current_hash = _hash(repr(sorted(current_identity.items())))
        if not hmac.compare_digest(current_hash, binding["identityHash"]):
            session["binding"] = None  # force re-verification
            raise BridgeError("bridge.identity_changed_reverify", 409)
        return binding["identity"]

    # -- heartbeat / health ---------------------------------------------------

    def heartbeat(self, token):
        session = self.authenticate(token)
        session["lastHeartbeatAt"] = self._clock()
        return {"sessionId": session["id"], "at": session["lastHeartbeatAt"]}

    def health(self, token):
        session = self.authenticate(token)
        last = session["lastHeartbeatAt"]
        if last is None:
            state = "no-heartbeat"
        else:
            age = (_parse(self._clock()) - _parse(last)).total_seconds()
            state = "healthy" if age <= HEARTBEAT_STALE_SECONDS else "stale"
        return {
            "sessionId": session["id"],
            "state": state,
            "lastHeartbeatAt": last,
            "queued": len(session["queue"]),
            "boundTerminal": session["binding"]["terminalId"] if session["binding"] else None,
            "terminals": [
                {"id": row["id"], "platform": row["platform"], "state": row["state"]}
                for row in self._terminals.values()
            ],
        }

    # -- bounded command queue --------------------------------------------------

    def enqueue(self, token, command):
        session = self.authenticate(token)
        session["queue"].push(command)

    def drain(self, token, limit=64):
        session = self.authenticate(token)
        return session["queue"].drain(limit)
