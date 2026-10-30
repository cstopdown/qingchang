import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

import https_app


class HTTPSProxyTest(unittest.IsolatedAsyncioTestCase):
    async def test_public_static_flow(self):
        requests = []
        audio = b'0123456789'

        async def static(request):
            requests.append((request.method, request.path_qs, dict(request.headers)))
            if request.path == '/sample.wav':
                if 'Range' in request.headers:
                    return web.Response(body=audio[2:6], status=206, headers={
                        'Content-Range': 'bytes 2-5/10', 'Accept-Ranges': 'bytes',
                    })
                return web.Response(body=audio)
            return web.Response(text='<html>轻唱</html>', content_type='text/html', headers={
                'Set-Cookie': 'private=secret', 'Authorization': 'Bearer upstream-secret',
            })

        upstream_app = web.Application()
        upstream_app.router.add_route('*', '/{path:.*}', static)
        async with TestServer(upstream_app) as upstream:
            with patch.object(https_app, 'UPSTREAM', str(upstream.make_url('')).rstrip('/')):
                async with TestClient(TestServer(https_app.create_app())) as client:
                    response = await client.get('/?token=secret', headers={
                        'Authorization': 'Bearer secret', 'Cookie': 'secret=secret',
                    })
                    self.assertEqual(response.status, 200)
                    self.assertEqual(await response.text(), '<html>轻唱</html>')
                    self.assertEqual(response.headers['Permissions-Policy'], 'microphone=(self), camera=(), geolocation=()')
                    self.assertNotIn('Set-Cookie', response.headers)
                    self.assertNotIn('Authorization', response.headers)
                    response = await client.head('/sample.wav')
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers['Content-Length'], '10')
                    self.assertEqual(await response.read(), b'')
                    response = await client.get('/sample.wav', headers={'Range': 'bytes=2-5'})
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.headers['Content-Range'], 'bytes 2-5/10')
                    self.assertEqual(await response.read(), audio[2:6])
                    for path in ('/ai', '/ai/health', '/ai/v2/score'):
                        self.assertEqual((await client.get(path)).status, 404)
                    self.assertEqual((await client.post('/', data=b'recording')).status, 405)
                    self.assertEqual((await client.post('/ai/v2/score')).status, 404)
        self.assertEqual(len(requests), 3)
        self.assertEqual(requests[0][1], '/')
        for _, _, headers in requests:
            self.assertNotIn('Authorization', headers)
            self.assertNotIn('Cookie', headers)


if __name__ == '__main__':
    unittest.main()
