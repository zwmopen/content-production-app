"""Exercise the real worker methods without importing production side effects."""
import ast
import asyncio
import json
import unittest
from pathlib import Path


def worker_class():
    path = Path(__file__).with_name('dual_browser_autonomous_producer.py')
    tree = ast.parse(path.read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'InstanceWorker')
    names = {'__init__', 'connect', 'force_gc', 'send_cmd', '_send_cmd_unlocked', 'close'}
    node.body = [n for n in node.body if getattr(n, 'name', '') in names]
    scope = {'asyncio': asyncio, 'json': json, 'log': lambda *args: None}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
    return scope['InstanceWorker']


class Socket:
    def __init__(self, fail=False, hold=None):
        self.closed = False
        self.active = 0
        self.max_active = 0
        self.message = None
        self.fail = fail
        self.hold = hold

    async def send(self, message):
        self.message = json.loads(message)

    async def recv(self):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.hold is not None:
                await self.hold.wait()
            await asyncio.sleep(.01)
            if self.fail:
                raise ConnectionError('disconnected')
            return json.dumps({'id': self.message['id'], 'result': {'method': self.message['method']}})
        finally:
            self.active -= 1

    async def close(self):
        self.closed = True


class Commands(unittest.IsolatedAsyncioTestCase):
    async def test_gc_and_production_never_receive_concurrently(self):
        worker = worker_class()('B', 9432)
        socket = worker.ws = Socket()
        results = await asyncio.gather(worker.send_cmd('Runtime.evaluate'), worker.force_gc())
        self.assertEqual(results[0]['result']['method'], 'Runtime.evaluate')
        self.assertTrue(results[1])
        self.assertEqual(socket.max_active, 1)

    async def test_reconnect_does_not_reenter_command_lock(self):
        worker = worker_class()('B', 9432)
        old = worker.ws = Socket(fail=True)
        replacement = Socket()
        async def connect():
            worker.ws = replacement
        worker._connect_unlocked = connect
        result = await asyncio.wait_for(worker.send_cmd('Runtime.evaluate'), 3)
        self.assertEqual(result['result']['method'], 'Runtime.evaluate')
        self.assertTrue(old.closed)

    async def test_explicit_connect_waits_for_exchange_and_replaces_socket(self):
        worker = worker_class()('B', 9432)
        event = asyncio.Event()
        old = worker.ws = Socket(hold=event)
        replacement = Socket()
        async def connect():
            worker.ws = replacement
        worker._connect_unlocked = connect
        command = asyncio.create_task(worker.send_cmd('Runtime.evaluate'))
        await asyncio.sleep(.02)
        reconnect = asyncio.create_task(worker.connect())
        await asyncio.sleep(.02)
        self.assertFalse(old.closed)
        event.set()
        await asyncio.wait_for(asyncio.gather(command, reconnect), 1)
        self.assertTrue(old.closed)
        self.assertIs(worker.ws, replacement)

    async def test_close_waits_for_active_exchange(self):
        worker = worker_class()('B', 9432)
        event = asyncio.Event()
        socket = worker.ws = Socket(hold=event)
        command = asyncio.create_task(worker.send_cmd('Runtime.evaluate'))
        await asyncio.sleep(.02)
        closer = asyncio.create_task(worker.close())
        await asyncio.sleep(.02)
        self.assertFalse(socket.closed)
        event.set()
        await asyncio.wait_for(asyncio.gather(command, closer), 1)
        self.assertTrue(socket.closed)
        self.assertIsNone(worker.ws)

    async def test_cancelled_exchange_closes_socket_and_releases_lock(self):
        worker = worker_class()('B', 9432)
        old = worker.ws = Socket(hold=asyncio.Event())
        command = asyncio.create_task(worker.send_cmd('Runtime.evaluate'))
        await asyncio.sleep(.02)
        command.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await command
        self.assertTrue(old.closed)
        self.assertIsNone(worker.ws)
        worker.ws = Socket()
        result = await asyncio.wait_for(worker.send_cmd('Runtime.evaluate'), 1)
        self.assertEqual(result['result']['method'], 'Runtime.evaluate')


if __name__ == '__main__':
    unittest.main()
