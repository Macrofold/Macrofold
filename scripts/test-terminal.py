"""Real POSIX PTY acceptance. Local simulator only; no model or sandbox calls."""
import fcntl
import json
import os
import pathlib
import pty
import select
import struct
import subprocess
import tempfile
import termios
import time

root = pathlib.Path(__file__).resolve().parent.parent
seed = json.loads((root / ".data/demo.json").read_text())
with tempfile.TemporaryDirectory(prefix="hosted-terminal-") as directory:
    env = {**os.environ, "AGENT_HOST": "http://localhost:3210", "AGENT_API_KEY": seed["api_key"], "AGENT_CONFIG_DIR": str(pathlib.Path(directory) / "credentials"), "TERM": "xterm-256color"}
    cli = ["node", str(root / "packages/cli/dist/index.mjs")]
    project = json.loads(subprocess.check_output(cli + ["project", "create", "PTY acceptance", "--json"], env=env, cwd=directory))["data"]
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 110, 0, 0))
    def own_terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    child = subprocess.Popen(cli + ["chat", "--project", project["id"], "--harness", "codex", "--model", "fixture-model"], stdin=slave, stdout=slave, stderr=slave, env=env, cwd=directory)
    transcript = bytearray()

    def until(needle, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if needle.encode() in transcript:
                return
            if select.select([master], [], [], 0.1)[0]:
                try:
                    transcript.extend(os.read(master, 65536))
                except OSError:
                    break
            if child.poll() is not None:
                break
        raise AssertionError(f"Terminal did not display {needle!r}. Last output: {transcript[-600:]!r}")

    try:
        until("Ready")
        # Wait for the terminal effect rather than racing React's first paint.
        deadline = time.monotonic() + 5
        while termios.tcgetattr(slave)[3] & termios.ICANON:
            if time.monotonic() > deadline:
                raise AssertionError("Ink did not enable raw input")
            if select.select([master], [], [], 0.02)[0]:
                transcript.extend(os.read(master, 65536))
        def submit(text):
            os.write(master, text.encode())
            time.sleep(0.05)
            os.write(master, b"\r")
        submit("Save a progress note")
        until("Accepted")
        submit("Add a second progress note")
        until("queue")
        until("files verified")
        submit("/status")
        until("latest_checkpoint_id")
        submit("/detach")
        deadline = time.monotonic() + 10
        while child.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.05)[0]:
                transcript.extend(os.read(master, 65536))
        child.wait(timeout=1)
        assert child.returncode == 0
        assert seed["api_key"].encode() not in transcript
        print("Real PTY: Ink rendering, prompt submission, queued follow-up, persistent result, status and detach passed.")
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        os.close(master)
        os.close(slave)
