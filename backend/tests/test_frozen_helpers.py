import pytest
from booster_recruiter.frozen_helpers import helper_invocation
from booster_recruiter.runtime import Runtime


@pytest.mark.parametrize("name", ["process_guardian.py", "process_gate.py"])
def test_accepts_only_packaged_helpers_and_preserves_arguments(tmp_path, name):
    helper = tmp_path / "booster_linkedin" / name
    helper.parent.mkdir()
    helper.touch()
    assert helper_invocation(
        ["app", "-I", "-S", "-u", str(helper), "12", "13", "0"], tmp_path
    ) == (helper, ["12", "13", "0"])


def test_same_named_helper_outside_bundle_is_rejected(tmp_path):
    outside = tmp_path / "process_guardian.py"
    outside.touch()
    with pytest.raises(ValueError, match="bundle"):
        helper_invocation(["app", "-I", "-S", "-u", str(outside)], tmp_path)


def test_arbitrary_script_is_never_an_interpreter_entrypoint(tmp_path):
    with pytest.raises(ValueError, match="Unsupported"):
        helper_invocation(
            ["app", "-I", "-S", "-u", str(tmp_path / "custom.py")], tmp_path
        )
    assert helper_invocation(["app", "--worker", "profile"], tmp_path) is None


def test_bootstrap_failure_does_not_tell_user_a_login_window_is_open():
    message = Runtime.friendly(
        Exception(
            "LinkedIn login bootstrap failed: The browser crash guardian did not start"
        )
    )
    assert "Окно входа не открыто" in message
    assert "Завершите вход" not in message
