from pathlib import Path

import pytest
from booster_recruiter.ocr import detect


@pytest.mark.parametrize(
    "name,expected",
    [
        ("open", "open_to_work"),
        ("hiring", "hiring"),
        ("green", "unknown"),
        ("red", "unknown"),
        ("shirt", "unknown"),
    ],
)
def test_portable_ocr_reads_label_not_background_color(name, expected):
    fixture = Path(__file__).parent / "fixtures" / f"avatar-{name}.png"
    result = detect(fixture.read_bytes())
    assert result["status"] == expected
    if expected != "unknown":
        assert result["evidence"] and result["evidence"][0]["confidence"] >= 0.8
