import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("fails", [False, True])
def test_selftest_closes_retained_trace_before_deleting_temp_data(fails):
    # A subprocess isolates the vendor's global configuration and trace state.
    # Assert the descriptor is closed even on platforms allowing open-file unlink.
    script = f"""
import os
from booster_recruiter import selftest
from booster_linkedin import debug_trace

retained = {{}}
async def check():
    path = debug_trace.mark_trace_for_retention()
    retained['root'] = path.parent.parent
    retained['fd'] = debug_trace._RUN_LOCK_FD
    assert retained['fd'] is not None
    if {fails!r}:
        raise RuntimeError('fixture failure')
    return {{'ok': True}}

selftest.check = check
try:
    selftest.run()
except RuntimeError as error:
    assert {fails!r} and str(error) == 'fixture failure'
else:
    assert not {fails!r}
assert not retained['root'].exists()
assert debug_trace._RUN_LOCK_FD is None
try:
    os.fstat(retained['fd'])
except OSError:
    pass
else:
    raise AssertionError('Trace descriptor was not closed')
"""
    env = dict(os.environ, LINKEDIN_TRACE_MODE="on_error")
    env.pop("LINKEDIN_DEBUG_TRACE_DIR", None)
    env["PYTHONPATH"] = os.pathsep.join(
        filter(None, [str(Path(__file__).resolve().parents[1]), env.get("PYTHONPATH")])
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert ('"ok": true' in result.stdout) is not fails
