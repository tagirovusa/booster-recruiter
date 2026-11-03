"""Dispatch the vendor's isolated helper commands in the frozen executable.

PyInstaller's sys.executable is this application, not a Python interpreter.
Keep the guardian and Windows process gate; never bypass process containment.
Only the two bundled stdlib-only helpers are accepted, not arbitrary scripts.
"""

import runpy
import sys
from pathlib import Path

HELPERS = frozenset({"process_guardian.py", "process_gate.py"})


def helper_invocation(argv, bundle_root):
    if len(argv) < 5 or argv[1:4] != ["-I", "-S", "-u"]:
        return None
    requested = Path(argv[4]).resolve()
    if requested.name not in HELPERS:
        raise ValueError("Unsupported frozen helper")
    expected = (Path(bundle_root) / "booster_linkedin" / requested.name).resolve()
    if requested != expected or not expected.is_file():
        raise ValueError("Helper must come from the application bundle")
    return expected, argv[5:]


def dispatch():
    invocation = helper_invocation(sys.argv, sys._MEIPASS)
    if invocation is None:
        return False
    helper, arguments = invocation
    sys.argv = [str(helper), *arguments]
    # These packaged files only import stdlib. Avoid importing the vendor
    # package initializer or the full application before the ready handshake.
    runpy.run_path(str(helper), run_name="__main__")
    return True
