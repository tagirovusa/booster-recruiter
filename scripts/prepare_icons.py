"""Build the macOS icon from the supplied, locally rendered brand asset."""

import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
if sys.platform == "darwin":
    iconset = root / "build" / "icon.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            suffix = "@2x" if scale == 2 else ""
            subprocess.run(
                [
                    "sips",
                    "-z",
                    str(size * scale),
                    str(size * scale),
                    str(root / "resources/icon.png"),
                    "--out",
                    str(iconset / f"icon_{size}x{size}{suffix}.png"),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
    subprocess.run(
        [
            "iconutil",
            "-c",
            "icns",
            str(iconset),
            "-o",
            str(root / "resources/icon.icns"),
        ],
        check=True,
    )
