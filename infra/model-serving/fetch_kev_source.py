"""Build-time only: install reviewed publisher code independently of model data."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

SOURCE = json.loads(Path(__file__).with_name("kev-source.json").read_text())
KEV_REVISION = SOURCE["revision"]
DESTINATION = Path("/opt/kev")


def main():
    with urllib.request.urlopen(f"https://codeload.github.com/jaredpalmer/kev/tar.gz/{KEV_REVISION}", timeout=90) as response:
        archive = response.read(160 * 1024 * 1024 + 1)
    if len(archive) > 160 * 1024 * 1024 or hashlib.sha256(archive).hexdigest() != SOURCE["archive_sha256"]:
        raise ValueError("Pinned Kev source archive checksum mismatch")
    DESTINATION.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for member in source:
            _, _, name = member.name.partition("/")
            selected = name in {"pyproject.toml", "uv.lock", "README.md", "LICENSE"} or name.startswith("kev/")
            if not selected or not member.isfile():
                continue
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe pinned source archive")
            target = DESTINATION / path
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as content:
                target.write_bytes(content.read())
    (DESTINATION / ".macrofold-source-revision").write_text(KEV_REVISION)


if __name__ == "__main__":
    main()
