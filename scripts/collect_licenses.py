"""Preserve upstream license notices alongside packaged binaries."""

import importlib.metadata
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / "licenses"
out.mkdir(exist_ok=True)
records = []
for dist in importlib.metadata.distributions():
    name = dist.metadata.get("Name", "unknown")
    records.append(
        {
            "name": name,
            "version": dist.version,
            "license": dist.metadata.get("License-Expression")
            or dist.metadata.get("License", ""),
            "homepage": dist.metadata.get("Home-page", ""),
        }
    )
    for entry in dist.files or []:
        path = Path(str(entry))
        if any(
            word in path.name.lower()
            for word in ["license", "copying", "notice", "ofl"]
        ) and ".dist-info" in str(entry):
            source = Path(dist.locate_file(entry))
            if source.is_file() and source.stat().st_size < 1_000_000:
                target = out / "python" / name / path.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
for name in ["react", "react-dom", "scheduler", "lucide-react", "electron"]:
    folder = root / "node_modules" / name
    for source in folder.glob("*"):
        if source.is_file() and source.name.lower().startswith(
            ("license", "notice", "copying")
        ):
            target = out / "node" / name / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
for name in ["LICENSE", "NOTICE"]:
    shutil.copy2(root / "vendor/booster-linkedin" / name, out / f"booster-linkedin-{name}.txt")
for name in ["LICENSE", "LICENSES.chromium.html"]:
    source = root / "node_modules/electron/dist" / name
    if source.is_file():
        shutil.copy2(source, out / ("electron-" + name))
(out / "python-dependencies.json").write_text(
    json.dumps(records, ensure_ascii=False, indent=2), encoding="utf8"
)
(out / "README.txt").write_text(
    "Third-party notices for Booster Recruiter. Original Business Booster LinkedIn source is Apache-2.0; see included LICENSE and NOTICE. Chromium and Electron notices are also included in their runtime folders. Portable OCR uses RapidOCR and locally bundled PaddleOCR models. Business Booster brand assets were supplied by the project owner. Nunito Sans is licensed under SIL Open Font License 1.1.\n",
    encoding="utf8",
)
print(
    f"Collected notices for {len(records)} installed Python distributions and renderer/runtime dependencies."
)
