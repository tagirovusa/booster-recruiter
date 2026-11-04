"""Source exports cannot discover private files beside the approved source."""

import hashlib
import importlib.util
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "source_archive", Path(__file__).resolve().parents[2] / "scripts/source_archive.py"
)
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], stderr=subprocess.DEVNULL
    )


def commit(root):
    git(root, "add", ".")
    git(
        root,
        "-c",
        "user.name=Archive Test",
        "-c",
        "user.email=archive@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "Source fixture",
    )


@pytest.fixture
def repository(tmp_path):
    if not shutil.which("git"):
        pytest.skip("Git-backed export scenarios require Git")
    root = tmp_path / "repository"
    root.mkdir()
    git(root, "init", "-q")
    (root / "README.md").write_text("Reviewed source\n", encoding="utf-8")
    (root / "backend").mkdir()
    (root / "backend/module.py").write_text("value = 1\n", encoding="utf-8")
    commit(root)
    return root


def extract(root, tmp_path):
    target = tmp_path / "first.zip"
    manifest = archive.create_archive(root, target)
    with zipfile.ZipFile(target) as bundle:
        bundle.extractall(tmp_path / "extracted")
    return tmp_path / "extracted/booster-recruiter", manifest


def test_only_committed_source_is_exported_despite_private_untracked_files(
    repository, tmp_path
):
    (repository / "backend/private-notes.txt").write_text("private fixture")
    (repository / "backend/connection.json").write_text("{}")
    (repository / "accounts").mkdir()
    (repository / "accounts/cookies.json").write_text("[]")
    target = tmp_path / "source.zip"
    manifest = archive.create_archive(repository, target)
    assert set(manifest["files"]) == {"README.md", "backend/module.py"}
    assert manifest["commit"] == git(repository, "rev-parse", "HEAD").decode().strip()
    with zipfile.ZipFile(target) as bundle:
        assert set(bundle.namelist()) == {
            "booster-recruiter/README.md",
            "booster-recruiter/backend/module.py",
            "booster-recruiter/SOURCE-MANIFEST.json",
        }
        assert bundle.read("booster-recruiter/backend/module.py") == git(
            repository, "show", "HEAD:backend/module.py"
        )


@pytest.mark.parametrize("staged", [False, True])
def test_dirty_tracked_source_requires_commit_and_preserves_prior_archive(
    repository, tmp_path, staged
):
    target = tmp_path / "source.zip"
    target.write_bytes(b"previous artifact")
    (repository / "README.md").write_text("Changed")
    if staged:
        git(repository, "add", "README.md")
    with pytest.raises(ValueError, match="Commit tracked changes"):
        archive.create_archive(repository, target)
    assert target.read_bytes() == b"previous artifact"


def test_extracted_kit_can_export_without_git_and_ignores_new_files(
    repository, tmp_path, monkeypatch
):
    root, first_manifest = extract(repository, tmp_path)
    (root / "backend/connection.json").write_text("{}")
    (root / "backend/private-notes.txt").write_text("private fixture")

    def no_git(*args):
        raise AssertionError("An extracted kit must not require Git")

    monkeypatch.setattr(archive, "git", no_git)
    second_manifest = archive.create_archive(root, tmp_path / "second.zip")
    assert second_manifest == first_manifest


@pytest.mark.parametrize("change", ["modified", "missing"])
def test_manifest_rejects_changed_or_missing_source(repository, tmp_path, change):
    root, _ = extract(repository, tmp_path)
    source = root / "backend/module.py"
    if change == "modified":
        source.write_text("unreviewed change")
    else:
        source.unlink()
    with pytest.raises(ValueError, match="Source changed|Missing source"):
        archive.create_archive(root, tmp_path / "second.zip")
    assert not (tmp_path / "second.zip").exists()


@pytest.mark.parametrize(
    "name",
    [
        "../outside.txt",
        "C:\\private.txt",
        "/private.txt",
        "runtime/module.py",
        ".git/config",
    ],
)
def test_manifest_rejects_unsafe_paths(tmp_path, name):
    (tmp_path / archive.MANIFEST).write_text(
        json.dumps({"format": 1, "files": {name: "0" * 64}})
    )
    with pytest.raises(ValueError, match="Not an exportable"):
        archive.create_archive(tmp_path, tmp_path / "source.zip")


def test_private_tracked_file_is_rejected_before_archive_write(repository, tmp_path):
    (repository / "backend/connection.json").write_text("{}")
    commit(repository)
    with pytest.raises(ValueError, match="privacy check failed"):
        archive.create_archive(repository, tmp_path / "source.zip")
    assert not (tmp_path / "source.zip").exists()


def test_private_manifest_entry_is_rejected_even_with_matching_checksum(tmp_path):
    (tmp_path / "cookies.json").write_bytes(b"[]")
    (tmp_path / archive.MANIFEST).write_text(
        json.dumps(
            {"format": 1, "files": {"cookies.json": hashlib.sha256(b"[]").hexdigest()}}
        )
    )
    with pytest.raises(ValueError, match="privacy check failed"):
        archive.create_archive(tmp_path, tmp_path / "source.zip")


def test_export_without_git_or_manifest_fails_closed(tmp_path):
    (tmp_path / "README.md").write_text("Some files")
    with pytest.raises(ValueError, match="source manifest is required"):
        archive.create_archive(tmp_path, tmp_path / "source.zip")


def test_symlinked_manifest_parent_is_rejected(repository, tmp_path):
    root, _ = extract(repository, tmp_path)
    (root / "backend").rename(root / "real-backend")
    try:
        (root / "backend").symlink_to(root / "real-backend", target_is_directory=True)
    except OSError:
        pytest.skip("Directory symlinks are unavailable in this environment")
    with pytest.raises(ValueError, match="Linked source"):
        archive.create_archive(root, tmp_path / "second.zip")
