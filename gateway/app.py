import os
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientSession, ClientTimeout, web

LIMIT = 100 * 1024 * 1024
DIST = Path(os.environ.get('QINGCHANG_DIST', 'dist')).resolve()
WORKER = os.environ['QINGCHANG_WORKER_URL'].rstrip('/')
TOKEN = os.environ['QINGCHANG_WORKER_TOKEN']
parsed = urlsplit(WORKER)
if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not TOKEN:
    raise ValueError('Invalid worker URL or token')


async def proxy(request):
    origin = request.headers.get('Origin')
    if origin is not None and origin != f'{request.scheme}://{request.host}':
        raise web.HTTPForbidden(text='Origin mismatch')
    if 'Content-Encoding' in request.headers:
        raise web.HTTPUnsupportedMediaType(text='Content-Encoding is not supported')
    if request.content_length is None and request.method == 'POST':
        raise web.HTTPLengthRequired()
    if request.content_length is not None and request.content_length > LIMIT:
        raise web.HTTPRequestEntityTooLarge(max_size=LIMIT, actual_size=request.content_length)
    headers = {'Authorization': f'Bearer {TOKEN}'}
    if request.method == 'POST':
        headers['Content-Type'] = request.headers['Content-Type']
        headers['Content-Length'] = str(request.content_length)
    try:
        async with request.app['session'].request(
            request.method, WORKER + request.path.removeprefix('/ai'),
            headers=headers, data=request.content.iter_chunked(65536) if request.method == 'POST' else None,
            allow_redirects=False,
        ) as upstream:
            response = web.StreamResponse(status=upstream.status, headers={
                k: v for k, v in upstream.headers.items() if k.lower() in ('content-type', 'content-length', 'retry-after')
            })
            await response.prepare(request)
            async for chunk in upstream.content.iter_chunked(65536):
                await response.write(chunk)
            return response
    except ClientError as error:
        raise web.HTTPBadGateway(text=f'Worker connection failed: {error}') from error


async def static(request):
    path = (DIST / request.match_info['path']).resolve()
    if not path.is_relative_to(DIST):
        raise web.HTTPNotFound()
    if path.is_dir():
        path = path / 'index.html'
    if not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path)


async def session_context(app):
    async with ClientSession(timeout=ClientTimeout(total=1200, connect=10)) as session:
        app['session'] = session
        yield


def create_app():
    app = web.Application(client_max_size=LIMIT)
    app.cleanup_ctx.append(session_context)
    app.router.add_get('/ai/health', proxy)
    app.router.add_post('/ai/v1/score', proxy)
    app.router.add_get('/{path:.*}', static)
    return app


if __name__ == '__main__':
    web.run_app(create_app(), host='127.0.0.1', port=8765)
