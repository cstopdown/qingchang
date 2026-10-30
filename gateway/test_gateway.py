import gzip
import os
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

os.environ['QINGCHANG_WORKER_URL'] = 'http://127.0.0.1:1'
os.environ['QINGCHANG_WORKER_TOKEN'] = 'secret'
import app as gateway


class GatewayTest(unittest.IsolatedAsyncioTestCase):
    async def test_proxy_flow(self):
        received = []
        health_calls = []

        async def health(request):
            self.assertEqual(request.headers['Authorization'], 'Bearer secret')
            self.assertNotIn('Origin', request.headers)
            health_calls.append(True)
            return web.json_response({'status': 'loading'}, status=503)

        async def score(request):
            self.assertEqual(request.headers['Authorization'], 'Bearer secret')
            self.assertNotIn('Origin', request.headers)
            received.append(await request.read())
            return web.json_response({'recordingId': 'one'}, status=201)

        worker = web.Application()
        worker.router.add_get('/health', health)
        worker.router.add_post('/v1/score', score)
        async with TestServer(worker) as upstream:
            gateway.WORKER = str(upstream.make_url('')).rstrip('/')
            async with TestClient(TestServer(gateway.create_app())) as client:
                origin = str(client.make_url('/')).rstrip('/')
                response = await client.get('/ai/health', headers={'Origin': origin})
                self.assertEqual(response.status, 503)
                self.assertEqual(await response.json(), {'status': 'loading'})
                self.assertEqual((await client.get('/ai/health', headers={'Origin': 'https://evil.example'})).status, 403)
                self.assertEqual((await client.get('/ai/health', headers={'Origin': 'null'})).status, 403)
                self.assertEqual(len(health_calls), 1)
                response = await client.post('/ai/v1/score', data=gzip.compress(b'audio'), headers={'Content-Encoding': 'gzip', 'Content-Type': 'audio/wav'})
                self.assertEqual(response.status, 415)
                self.assertEqual(received, [])
                audio = b'audio' * 100000
                response = await client.post('/ai/v1/score', data=audio, headers={'Content-Type': 'audio/wav'})
                self.assertEqual(response.status, 201)
                self.assertEqual(await response.json(), {'recordingId': 'one'})
                self.assertEqual(received, [audio])
                self.assertEqual((await client.get('/ai/unknown')).status, 404)


if __name__ == '__main__':
    unittest.main()
