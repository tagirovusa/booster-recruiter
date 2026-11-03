# Adapted for Business Booster Recruiter.
"""Business Booster browser adapter for LinkedIn account workflows."""

from importlib.metadata import PackageNotFoundError, version

from booster_linkedin.greenlet_runtime import explain_a_missing_runtime

explain_a_missing_runtime()

try:
    __version__ = version("booster-linkedin-runtime")
except PackageNotFoundError:
    __version__ = "0.0.0.dev"
