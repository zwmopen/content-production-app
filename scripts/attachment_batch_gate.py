"""Fail-closed contract for multi-image production inputs."""


def is_complete_attachment_batch(observed_count: int, expected_count: int) -> bool:
    """Return true only when every expected attachment is observed exactly once."""
    if isinstance(observed_count, bool) or isinstance(expected_count, bool):
        return False
    if not isinstance(observed_count, int) or not isinstance(expected_count, int):
        return False
    return expected_count > 0 and observed_count == expected_count
