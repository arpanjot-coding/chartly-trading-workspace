"""Flow HTTP policy and transport checks with in-memory network fixtures."""

import gzip
import socket
import ssl
from collections import deque
from types import SimpleNamespace

import pytest
from dns import exception, resolver

from services import flow_executor_service as fes


class _Socket:
    def __init__(self, chunks):
        self.chunks = deque(chunks)
        self.endpoint = None
        self.sent = bytearray()
        self.closed = False

    def settimeout(self, timeout):
        self.timeout = timeout

    def connect(self, endpoint):
        self.endpoint = endpoint

    def setsockopt(self, *_args):
        pass

    def send(self, content):
        self.sent.extend(content)
        return len(content)

    def recv(self, size):
        chunk = self.chunks.popleft() if self.chunks else b""
        assert len(chunk) <= size
        return chunk

    def close(self):
        self.closed = True


def _reply(body=b'{"accepted":true}', headers=b"", status=b"200 OK"):
    return (
        b"HTTP/1.1 "
        + status
        + b"\r\nContent-Length: "
        + str(len(body)).encode()
        + b"\r\n"
        + headers
        + b"\r\n"
        + body
    )


@pytest.fixture
def network(monkeypatch):
    state = SimpleNamespace(answers=["93.184.215.14"], dns_calls=[], sockets=[], chunks=[])

    def resolve_name(host, *, lifetime, search):
        state.dns_calls.append((host, lifetime, search))
        return SimpleNamespace(addresses=lambda: iter(state.answers))

    def open_socket(family, socktype):
        assert socktype == socket.SOCK_STREAM
        sock = _Socket(state.chunks)
        sock.family = family
        state.sockets.append(sock)
        return sock

    monkeypatch.setattr(resolver, "resolve_name", resolve_name)
    monkeypatch.setattr(
        fes,
        "socket",
        SimpleNamespace(
            socket=open_socket,
            AF_INET=socket.AF_INET,
            AF_INET6=socket.AF_INET6,
            SOCK_STREAM=socket.SOCK_STREAM,
            IPPROTO_TCP=socket.IPPROTO_TCP,
            TCP_NODELAY=socket.TCP_NODELAY,
        ),
    )
    return state


def _execute(**node):
    return fes.NodeExecutor(None, fes.WorkflowContext(), []).execute_http_request(node)


@pytest.mark.parametrize(
    "address, family, endpoint",
    [
        ("93.184.215.14", socket.AF_INET, ("93.184.215.14", 8443)),
        ("2606:4700:4700::1111", socket.AF_INET6, ("2606:4700:4700::1111", 8443, 0, 0)),
    ],
)
def test_https_uses_the_validated_endpoint_and_original_tls_identity(
    monkeypatch, network, address, family, endpoint
):
    network.answers = [address]
    network.chunks = [_reply()]
    tls_checks = []

    def wrap_socket(context, sock, *, server_hostname):
        tls_checks.append((server_hostname, context.check_hostname, context.verify_mode))
        return sock

    monkeypatch.setattr(ssl.SSLContext, "wrap_socket", wrap_socket)
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:8080")
    result = _execute(
        method="POST",
        url="https://example.test:8443/v1/hello?x=1",
        headers='{"Authorization":"Bearer fixture"}',
        body='{"check": true}',
    )

    assert result == {"status": "success", "statusCode": 200, "data": {"accepted": True}}
    [(resolved, budget, search)] = network.dns_calls
    assert resolved == "example.test" and 0 < budget <= 30 and search is False
    [sock] = network.sockets
    assert sock.family == family and sock.endpoint == endpoint and sock.closed
    assert tls_checks == [("example.test", True, ssl.CERT_REQUIRED)]
    assert b"POST /v1/hello?x=1 HTTP/1.1\r\n" in sock.sent
    assert b"Host: example.test:8443\r\n" in sock.sent
    assert b"Authorization: Bearer fixture\r\n" in sock.sent
    assert sock.sent.endswith(b'{"check":true}')


def test_mixed_dns_answer_is_rejected_before_opening_a_socket(network):
    network.answers.append("100.64.0.1")
    result = _execute(url="http://example.test/")
    assert result["status"] == "error" and "public address" in result["message"]
    assert network.sockets == []


def test_dns_timeout_does_not_open_a_socket(network, monkeypatch):
    def timeout(*_args, **_kwargs):
        raise exception.Timeout

    monkeypatch.setattr(resolver, "resolve_name", timeout)
    assert _execute(url="https://example.test/") == {
        "status": "error",
        "message": "HTTP request timed out",
    }
    assert network.sockets == []


def test_tls_rejection_closes_the_socket_without_sending_headers(network, monkeypatch):
    def reject(*_args, **_kwargs):
        raise ssl.SSLCertVerificationError("fixture certificate rejected")

    monkeypatch.setattr(ssl.SSLContext, "wrap_socket", reject)
    result = _execute(url="https://example.test/", headers={"Authorization": "fixture"})
    assert result == {"status": "error", "message": "HTTP server certificate verification failed"}
    assert network.sockets[0].closed and not network.sockets[0].sent


def test_redirect_is_returned_without_following_it(network):
    network.chunks = [_reply(b"", b"Location: https://other.example.test/\r\n", b"302 Found")]
    result = _execute(url="http://example.test/")
    assert result == {"status": "error", "statusCode": 302, "data": ""}
    assert len(network.dns_calls) == len(network.sockets) == 1
    assert network.sockets[0].closed


def test_gzip_is_decoded_with_a_bounded_output(network, monkeypatch):
    monkeypatch.setattr(fes, "_HTTP_MAX_BODY_BYTES", 48)
    headers = b"Content-Encoding: gzip\r\n"
    network.chunks = [_reply(gzip.compress(b'{"accepted":true}'), headers)]
    assert _execute(url="http://example.test/")["data"] == {"accepted": True}

    wire = gzip.compress(b"x" * 256)
    assert len(wire) < fes._HTTP_MAX_BODY_BYTES
    network.chunks = [_reply(wire, headers)]
    result = _execute(url="http://example.test/")
    assert result["status"] == "error" and "size limit" in result["message"]
    assert all(sock.closed for sock in network.sockets)


def test_header_reads_share_an_absolute_deadline(network, monkeypatch):
    clock = SimpleNamespace(now=100.0)
    monkeypatch.setattr(fes, "time_module", SimpleNamespace(monotonic=lambda: clock.now))
    recv = _Socket.recv
    timeouts = []

    def slow_recv(sock, size):
        timeouts.append(sock.timeout)
        if sock.timeout < 0.6:
            clock.now += sock.timeout
            raise TimeoutError
        clock.now += 0.6
        return recv(sock, size)

    monkeypatch.setattr(_Socket, "recv", slow_recv)
    network.chunks = [b"HTTP/1.1 200 OK\r\n", b"Content-Length: 2\r\n\r\n{}"]
    result = _execute(url="http://example.test/", timeout=1000)

    assert result == {"status": "error", "message": "HTTP request timed out"}
    assert timeouts == pytest.approx([1.0, 0.4])
    assert network.sockets[0].closed
