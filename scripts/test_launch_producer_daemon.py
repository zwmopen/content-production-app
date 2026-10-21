import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("launch_producer_daemon.py")
SPEC = importlib.util.spec_from_file_location("launch_producer_daemon", SCRIPT)
LAUNCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCHER)


class FakeProcess:
    pid = 43210


class ProducerDaemonLauncherTests(unittest.TestCase):
    def test_preserves_existing_producer_lock_and_spawns_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / "runtime"
            runtime.mkdir()
            pid_file = runtime / "producer.pid"
            pid_file.write_text("4156", encoding="utf-8")
            producer_script = root / "producer.py"
            producer_script.write_text("pass\n", encoding="utf-8")
            calls = []

            def fake_popen(args, **kwargs):
                calls.append((args, kwargs))
                return FakeProcess()

            process = LAUNCHER.launch_producer_daemon(
                script=producer_script,
                project_root=root,
                runtime_dir=runtime,
                python_exe="python-test",
                popen=fake_popen,
            )

            self.assertEqual(process.pid, 43210)
            self.assertEqual(pid_file.read_text(encoding="utf-8"), "4156")
            self.assertEqual(len(calls), 1)
            args, kwargs = calls[0]
            self.assertEqual(args, ["python-test", "-u", str(producer_script)])
            self.assertEqual(kwargs["cwd"], str(root))
            self.assertTrue((runtime / "producer_daemon_stdout.log").exists())
            self.assertTrue((runtime / "producer_daemon_stderr.log").exists())

    def test_missing_script_fails_before_creating_runtime_or_spawning(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / "runtime"
            calls = []

            with self.assertRaises(FileNotFoundError):
                LAUNCHER.launch_producer_daemon(
                    script=root / "missing.py",
                    project_root=root,
                    runtime_dir=runtime,
                    popen=lambda *args, **kwargs: calls.append(args),
                )

            self.assertFalse(runtime.exists())
            self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
