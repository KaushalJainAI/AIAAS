"""One user's run cannot see another's: a Unix user per slot, private folders,
and nothing left alive between runs.

The leak these pin was measured before slots existed: a Python run forked a
process that called `setsid` (leaving the run's process group, so the timeout
kill missed it), then read the *next* run's input file out of /tmp.

Needs the image running as root (the only place users can be switched), so
these skip anywhere else. Run them in the image as `sandbox_service/README.md`
shows.
"""
from __future__ import annotations

import os
import sys
import threading
import time
import unittest

_SVC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SVC_DIR not in sys.path:
    sys.path.insert(0, _SVC_DIR)

import executor  # noqa: E402

_AS_ROOT_IN_IMAGE = (os.name == "posix" and os.geteuid() == 0
                     and os.access(executor.NODE, os.X_OK))
_needs_root = unittest.skipUnless(_AS_ROOT_IN_IMAGE, "needs the sidecar image, as root")

_SPY = '''
import os, time
if os.fork() == 0:
    os.setsid()
    os.closerange(0, 3)
    for _ in range(40):
        try:
            for d in os.listdir('/tmp'):
                for root, _dirs, names in os.walk('/tmp/' + d):
                    for n in names:
                        if n == 'customer_list.csv':
                            open('/tmp/LEAKED', 'w').write(open(os.path.join(root, n)).read())
        except Exception:
            pass
        time.sleep(0.2)
    os._exit(0)
result = 'spy started'
'''


def _live_processes_of(uid: int) -> list[int]:
    """Pids owned by `uid` that are still running (zombies awaiting their
    reaper are dead already and do not count)."""
    live = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            if os.stat(f"/proc/{pid}").st_uid != uid:
                continue
            with open(f"/proc/{pid}/stat") as handle:
                state = handle.read().rsplit(")", 1)[1].split()[0]
        except (FileNotFoundError, ProcessLookupError, IndexError):
            continue
        if state not in ("Z", "X"):
            live.append(int(pid))
    return live


@_needs_root
class SlotIsolationTests(unittest.TestCase):
    def test_a_run_executes_as_its_slots_user(self):
        env = executor.execute("import os\nresult = [os.getuid(), os.getgid(), os.getgroups()]",
                               slot=2)
        self.assertTrue(env["success"], env)
        uid = executor.SLOT_ID_BASE + 2
        self.assertEqual(env["result"], [uid, uid, []])

    def test_commands_execute_as_the_slots_user_too(self):
        env = executor.execute_commands([{"command": "stat", "args": ["-c", "%u", "."]}],
                                        slot=3)
        self.assertEqual(env["output"].strip(), str(executor.SLOT_ID_BASE + 3))

    def test_root_without_a_slot_is_refused(self):
        with self.assertRaises(RuntimeError):
            executor.execute("result = 1")
        with self.assertRaises(RuntimeError):
            executor.execute("result = 1", slot=executor.MAX_SLOTS + 1)

    def test_nothing_survives_into_the_next_run_in_the_slot(self):
        uid = executor.SLOT_ID_BASE + 1
        spy = executor.execute(_SPY, slot=1)
        self.assertTrue(spy["success"], spy)
        # The spy forked and left its process group; the run's own cleanup
        # must have killed it anyway, before the slot is handed out again.
        self.assertEqual(_live_processes_of(uid), [])
        victim = executor.execute(
            "import time; time.sleep(1.5); result = open('customer_list.csv').read()",
            slot=1, files={"customer_list.csv": b"secret,rows\n"})
        self.assertEqual(victim["result"], "secret,rows\n")
        self.assertEqual(_live_processes_of(uid), [])

    def test_tmp_cannot_be_listed_or_written(self):
        env = executor.execute(
            "import os\n"
            "out = []\n"
            "for op in (lambda: os.listdir('/tmp'), lambda: open('/tmp/x', 'w')):\n"
            "    try:\n"
            "        op(); out.append('allowed')\n"
            "    except PermissionError:\n"
            "        out.append('denied')\n"
            "result = out\n", slot=1)
        self.assertEqual(env["result"], ["denied", "denied"])

    def test_a_concurrent_run_in_another_slot_cannot_read_this_ones_files(self):
        holder: dict = {}

        def _hold():
            holder["env"] = executor.execute(
                "import time; time.sleep(3); result = open('customer_list.csv').read()",
                slot=1, files={"customer_list.csv": b"secret,rows\n"})

        thread = threading.Thread(target=_hold)
        thread.start()
        # The test (root) finds the folder's real path, which a run could not:
        # handing it to the other slot is the strongest version of the attack.
        path = None
        for _ in range(50):
            runs = [d for d in os.listdir("/tmp") if d.startswith("run-")]
            for d in runs:
                candidate = f"/tmp/{d}/work/customer_list.csv"
                if os.path.exists(candidate):
                    path = candidate
            if path:
                break
            time.sleep(0.05)
        self.assertIsNotNone(path)
        thief = executor.execute(
            f"try:\n    result = open({path!r}).read()\nexcept PermissionError:\n"
            f"    result = 'denied'\n", slot=2)
        thread.join()
        self.assertEqual(thief["result"], "denied")
        self.assertEqual(holder["env"]["result"], "secret,rows\n")

    def test_a_fork_bomb_is_bounded_per_slot(self):
        env = executor.execute(
            "import os\n"
            "n = 0\n"
            "try:\n"
            "    for _ in range(500):\n"
            "        if os.fork() == 0:\n"
            "            os.closerange(0, 3)  # let the run itself finish\n"
            "            import time; time.sleep(30); os._exit(0)\n"
            "        n += 1\n"
            "except BlockingIOError:\n"
            "    pass\n"
            "result = n\n", slot=1, wall_seconds=10)
        self.assertTrue(env["success"], env)
        self.assertLess(env["result"], executor.NPROC_PER_SLOT)
        # And they are all gone afterwards: the next run in the slot is alone.
        self.assertEqual(_live_processes_of(executor.SLOT_ID_BASE + 1), [])


if __name__ == "__main__":
    unittest.main()
