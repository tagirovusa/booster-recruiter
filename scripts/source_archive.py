"""Produce a source-only handoff; never traverse browser sessions or build outputs."""
import hashlib
import argparse
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path)
args=parser.parse_args()
target=args.output or root.parent/'Booster-Recruiter-Windows-build-kit.zip'
include=['backend','desktop','src','public','resources','licenses','scripts','docs','vendor','.github']
files=['README.md','BUILD-WINDOWS.cmd','package.json','package-lock.json','pyproject.toml','uv.lock','index.html','.gitignore']
excluded={'__pycache__','.pytest_cache','.ruff_cache','node_modules','.venv','build','release','runtime'}
selected=[root/name for name in files]
for name in include:
    selected.extend(p for p in (root/name).rglob('*') if p.is_file() and not p.is_symlink() and not any(part in excluded or part.endswith('.egg-info') for part in p.relative_to(root).parts) and p.suffix!='.pyc')
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for p in sorted(selected):archive.write(p,Path('booster-recruiter')/p.relative_to(root))
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert not any(n.endswith(('cookies.json','connection.json','.sqlite3','.db')) for n in archive.namelist())
print(f'{target.name}: {len(selected)} files, {target.stat().st_size:,} bytes, SHA256 {hashlib.sha256(target.read_bytes()).hexdigest()}')
