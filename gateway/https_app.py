"""Public TLS entry point for the static preview; private AI stays separate."""
import asyncio
import os
import ssl

from aiohttp import ClientConnectionError, ClientSession, ClientTimeout, DummyCookieJar, web
from yarl import URL

UPSTREAM = 'http://127.0.0.1:9000'
REQUEST_HEADERS = ('Range', 'If-Range', 'If-None-Match', 'If-Modified-Since', 'Accept-Encoding')
RESPONSE_HEADERS = (
    'Content-Type', 'Content-Length', 'Content-Encoding', 'Content-Range',
    'Accept-Ranges', 'Cache-Control', 'ETag', 'Last-Modified', 'Vary',
)
SESSION = web.AppKey('session', ClientSession)


async def static_proxy(request):
    if request.path == '/ai' or request.path.startswith('/ai/'):
        raise web.HTTPNotFound()
    if request.method not in ('GET', 'HEAD'):
        raise web.HTTPMethodNotAllowed(request.method, ['GET', 'HEAD'])

    # Use a fixed authority and omit query strings, cookies and credentials.
    url = URL(UPSTREAM + request.rel_url.raw_path, encoded=True)
    headers = {name: request.headers[name] for name in REQUEST_HEADERS if name in request.headers}
    try:
        upstream = await request.app[SESSION].request(
            request.method, url, headers=headers, allow_redirects=False,
        )
    except asyncio.TimeoutError:
        raise web.HTTPGatewayTimeout() from None
    except ClientConnectionError:
        raise web.HTTPBadGateway() from None

    async with upstream:
        response = web.StreamResponse(status=upstream.status, headers={
            name: upstream.headers[name] for name in RESPONSE_HEADERS if name in upstream.headers
        })
        response.headers['Permissions-Policy'] = 'microphone=(self), camera=(), geolocation=()'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        await response.prepare(request)
        if request.method == 'GET':
            async for chunk in upstream.content.iter_chunked(64 * 1024):
                await response.write(chunk)
        await response.write_eof()
        return response


async def session_context(app):
    async with ClientSession(
        timeout=ClientTimeout(total=120, connect=5, sock_read=30),
        auto_decompress=False,
        cookie_jar=DummyCookieJar(),
    ) as session:
        app[SESSION] = session
        yield


def create_app():
    app = web.Application()
    app.cleanup_ctx.append(session_context)
    app.router.add_route('*', '/{path:.*}', static_proxy)
    return app


if __name__ == '__main__':
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(os.environ['QINGCHANG_TLS_CERT'], os.environ['QINGCHANG_TLS_KEY'])
    # Avoid logging URLs, query strings or arbitrary public request data.
    web.run_app(create_app(), host='0.0.0.0', port=443, ssl_context=tls, access_log=None)
