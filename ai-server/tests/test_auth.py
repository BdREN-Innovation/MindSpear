import httpx
import pytest

from app.errors import AuthError, UpstreamError
from app.security.auth import TokenVerifier, bearer_token
from app.security.rate_limit import RateLimiter

RealAsyncClient = httpx.AsyncClient


def test_bearer_token_parsing():
    assert bearer_token("Bearer abc") == "abc"
    assert bearer_token("bearer  abc ") == "abc"
    for bad in (None, "", "Token abc", "Bearer null", "Bearer undefined"):
        with pytest.raises(AuthError):
            bearer_token(bad)


class FakeTransport(httpx.AsyncBaseTransport):
    def __init__(self, status: int):
        self.status = status
        self.calls = 0

    async def handle_async_request(self, request):
        self.calls += 1
        assert request.headers["Authorization"] == "Bearer tok"
        assert str(request.url) == "http://laravel.test/api/v1/profile/show"
        return httpx.Response(self.status)


async def test_verifier_caches_a_good_token(monkeypatch):
    transport = FakeTransport(200)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: RealAsyncClient(transport=transport))
    now = [0.0]
    verifier = TokenVerifier(api_url="http://laravel.test/api/v1/", cache_seconds=60, timeout=1, clock=lambda: now[0])

    user = await verifier.verify("tok")
    await verifier.verify("tok")
    assert transport.calls == 1
    assert user.key != "tok" and len(user.key) == 64

    now[0] = 61
    await verifier.verify("tok")
    assert transport.calls == 2


async def test_verifier_rejects_bad_token_and_reports_unreachable_api(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: RealAsyncClient(transport=FakeTransport(401)))
    with pytest.raises(AuthError):
        await TokenVerifier(api_url="http://laravel.test/api/v1", cache_seconds=60, timeout=1).verify("tok")

    class Down(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: RealAsyncClient(transport=Down()))
    with pytest.raises(UpstreamError):
        await TokenVerifier(api_url="http://laravel.test/api/v1", cache_seconds=60, timeout=1).verify("tok")


def test_rate_limiter_window_slides():
    now = [0.0]
    limiter = RateLimiter(limit=2, window_seconds=60, clock=lambda: now[0])
    limiter.hit("a")
    limiter.hit("a")
    with pytest.raises(Exception, match="too quickly"):
        limiter.hit("a")
    limiter.hit("b")  # another caller is unaffected
    now[0] = 60
    limiter.hit("a")  # the first call has left the window


async def test_verifier_keeps_the_laravel_user_id_for_traces(monkeypatch):
    class ProfileTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            return httpx.Response(200, json={"data": {"profile": {"id": 42, "email": "x@example.test"}}})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: RealAsyncClient(transport=ProfileTransport()))
    verifier = TokenVerifier(api_url="http://laravel.test/api/v1", cache_seconds=60, timeout=1, clock=lambda: 0.0)

    assert (await verifier.verify("tok")).id == "42"
    assert (await verifier.verify("tok")).id == "42"  # from the cache
