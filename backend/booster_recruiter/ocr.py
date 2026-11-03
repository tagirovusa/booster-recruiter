"""Offline, portable OCR of the avatar perimeter. No remote inference."""

from __future__ import annotations

import io
import re
from functools import lru_cache

import numpy as np
from PIL import Image


@lru_cache(maxsize=1)
def engine():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)


def detect(png: bytes):
    if len(png) > 8_000_000:
        raise ValueError("Avatar too large")
    image = Image.open(io.BytesIO(png)).convert("RGB")
    if min(image.size) < 48 or min(image.size) / max(image.size) < 0.85:
        return {
            "status": "unknown",
            "method": "local_ocr",
            "reason": "invalid_photo",
            "evidence": [],
        }
    pixels = np.array(image.resize((512, 512), Image.Resampling.LANCZOS))
    found = {}
    ocr = engine()
    for seam in range(4):
        for reverse in (False, True):
            angle = (
                seam * np.pi / 2
                + (-1 if reverse else 1) * np.arange(1600) / 1600 * 2 * np.pi
            )
            radius = 255.5 * np.linspace(0.64, 0.99, 150)
            if not reverse:
                radius = radius[::-1]
            x = np.clip(
                np.rint(255.5 + radius[:, None] * np.cos(angle)), 0, 511
            ).astype(int)
            y = np.clip(
                np.rint(255.5 + radius[:, None] * np.sin(angle)), 0, 511
            ).astype(int)
            strip = pixels[y, x]
            result, _ = ocr(strip, use_cls=False)
            for _, text, score in result or []:
                token = re.sub(r"[\s_#]", "", text.casefold())
                status = {"opentowork": "open_to_work", "hiring": "hiring"}.get(token)
                if status and score >= 0.8:
                    found[status] = {
                        "source": "local_ocr",
                        "text": text,
                        "confidence": float(score),
                        "region": "avatar_perimeter",
                    }
    status = next(iter(found)) if len(found) == 1 else "unknown"
    return {
        "status": status,
        "method": "local_ocr",
        "reason": "explicit_perimeter_text"
        if len(found) == 1
        else "no_clear_frame_label",
        "evidence": list(found.values()),
    }
