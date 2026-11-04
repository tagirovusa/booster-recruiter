"""Export reviewed source only; never discover files by walking the workspace."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import uuid
import zipfile
from pathlib import Path, PurePosixPath

MANIFEST = "SOURCE-MANIFEST.json"
EXCLUDED = {
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "build",
    "release",
    "runtime",
}
spec = importlib.util.spec_from_file_location(
    "archive_privacy", Path(__file__).with_name("check_repository.py")
)
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


def checked_name(name):
    if not isinstance(name, str):
        raise ValueError("Source manifest paths must be text.")
    path = PurePosixPath(name)
    if (
        not name
        or path.is_absolute()
        or path.as_posix() != name
        or any(part in (".", "..") for part in path.parts)
        or "\\" in name
        or ":" in name
        or "\0" in name
        or name == MANIFEST
        or any(part in EXCLUDED or part.endswith(".egg-info") for part in path.parts)
        or path.suffix == ".pyc"
    ):
        raise ValueError(f"Not an exportable source path: {name!r}")
    return name


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], stderr=subprocess.PIPE
    )


def source_files(root):
    files = {}
    if (root / ".git").exists():
        commit = git(root, "rev-parse", "HEAD").decode().strip()
        if git(root, "diff", "--name-only", commit, "--").strip():
            raise ValueError("Commit tracked changes before exporting source.")
        for entry in git(root, "ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
            if not entry:
                continue
            metadata, name = entry.split(b"\t", 1)
            mode, kind, blob = metadata.decode().split()
            name = checked_name(name.decode("utf-8"))
            if kind != "blob" or mode not in ("100644", "100755"):
                raise ValueError(f"Links and submodules cannot be exported: {name}")
            files[name] = git(root, "cat-file", "blob", blob)
    else:
        manifest_path = root / MANIFEST
        if not manifest_path.is_file() or manifest_path.is_symlink():
            raise ValueError(
                "A source checkout or an exported source manifest is required."
            )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (
            not isinstance(manifest, dict)
            or manifest.get("format") != 1
            or not isinstance(manifest.get("files"), dict)
            or not manifest["files"]
        ):
            raise ValueError("Invalid source manifest.")
        commit = manifest.get("commit")
        for name, checksum in manifest["files"].items():
            name = checked_name(name)
            path = root / name
            current = path
            while current != root:
                if current.is_symlink():
                    raise ValueError(f"Linked source file: {name}")
                current = current.parent
            if not path.is_file():
                raise ValueError(f"Missing source file: {name}")
            data = path.read_bytes()
            if (
                not isinstance(checksum, str)
                or hashlib.sha256(data).hexdigest() != checksum
            ):
                raise ValueError(f"Source changed since export: {name}")
            files[name] = data
    if not files:
        raise ValueError("The source file list is empty.")
    for name, data in files.items():
        reasons = privacy.violations(name, data)
        if reasons:
            raise ValueError(
                f"Source privacy check failed for {name}: {', '.join(reasons)}"
            )
    return commit, files


def create_archive(root, target):
    root, target = Path(root).resolve(), Path(target).resolve()
    commit, files = source_files(root)
    manifest = {
        "format": 1,
        "commit": commit,
        "files": {
            name: hashlib.sha256(data).hexdigest()
            for name, data in sorted(files.items())
        },
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with zipfile.ZipFile(
            temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for name, data in sorted(files.items()):
                archive.writestr("booster-recruiter/" + name, data)
            archive.writestr(
                "booster-recruiter/" + MANIFEST,
                json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            )
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError("Source archive verification failed.")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return manifest


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    target = args.output or root.parent / "Booster-Recruiter-Windows-build-kit.zip"
    try:
        manifest = create_archive(root, target)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    print(
        f"{target.name}: {len(manifest['files'])} source files, {target.stat().st_size:,} bytes, SHA256 {hashlib.sha256(target.read_bytes()).hexdigest()}"
    )


if __name__ == "__main__":
    main()
