"""Pacing contracts with an injected clock; no browser traffic or wall-clock waits."""

import asyncio

import pytest
from booster_recruiter.pacing import BrowserPacer


class Clock:
    def __init__(self):
        self.value = 100.0
        self.waits = []

    def __call__(self):
        return self.value

    async def sleep(self, seconds):
        self.waits.append(seconds)
        self.value += seconds


@pytest.mark.parametrize("gap", [8.0, 11.0, 14.0])
async def test_next_operation_waits_after_slow_operation_finishes(gap):
    clock = Clock()
    samples = []

    def uniform(low, high):
        samples.append((low, high))
        return gap

    pacer = BrowserPacer(clock=clock, uniform=uniform, sleep=clock.sleep)
    await pacer.wait_command()
    assert not clock.waits  # Opening the first command is not delayed.
    clock.value += 90  # A slow profile load doesn't count as the next rest gap.
    pacer.finish_command()
    await pacer.wait_command()
    assert clock.waits == [gap]
    assert clock.value == 190 + gap
    assert samples == [(8.0, 14.0)]


async def test_idle_time_is_subtracted_without_adding_another_full_pause():
    clock = Clock()
    pacer = BrowserPacer(clock=clock, uniform=lambda *_: 12, sleep=clock.sleep)
    pacer.finish_command()
    clock.value += 5
    await pacer.wait_command()
    assert clock.waits == [7]
    pacer.finish_command()
    clock.value += 60
    await pacer.wait_command()
    assert clock.waits == [7]


async def test_repeated_commands_receive_fresh_independent_bounded_gaps():
    clock = Clock()
    gaps = iter([8, 14, 9.5])
    pacer = BrowserPacer(clock=clock, uniform=lambda *_: next(gaps), sleep=clock.sleep)
    for duration in [1, 40, 2]:
        clock.value += duration
        pacer.finish_command()
        await pacer.wait_command()
    assert clock.waits == [8, 14, 9.5]


@pytest.mark.parametrize("choose", [lambda low, high: low, lambda low, high: high])
async def test_navigation_and_submission_have_separate_pause_ranges(choose):
    clock = Clock()
    samples = []

    def uniform(low, high):
        samples.append((low, high))
        return choose(low, high)

    pacer = BrowserPacer(clock=clock, uniform=uniform, sleep=clock.sleep)
    await pacer.step()
    await pacer.before_submit()
    assert samples == [(1.5, 3.5), (2.0, 4.0)]
    assert clock.waits == [choose(1.5, 3.5), choose(2.0, 4.0)]


async def test_cancel_during_pause_never_starts_the_following_action():
    clock = Clock()
    waiting = asyncio.Event()
    release = asyncio.Event()
    actions = []

    async def cancellable_sleep(seconds):
        waiting.set()
        await release.wait()
        clock.value += seconds

    pacer = BrowserPacer(clock=clock, uniform=lambda *_: 10, sleep=cancellable_sleep)
    pacer.finish_command()

    async def command():
        await pacer.wait_command()
        actions.append("browser action")

    task = asyncio.create_task(command())
    await waiting.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert actions == []
    # Cancellation didn't claim that the elapsed gap had already completed.
    assert pacer.next_command_at == 110
    pacer.sleep = clock.sleep
    await pacer.wait_command()
    assert clock.waits == [10]


async def test_failed_command_has_the_same_gap_before_a_later_operation():
    clock = Clock()
    pacer = BrowserPacer(clock=clock, uniform=lambda *_: 14, sleep=clock.sleep)
    with pytest.raises(ConnectionError):
        try:
            await pacer.wait_command()
            clock.value += 20
            raise ConnectionError("A failed request must not cause a burst")
        finally:
            pacer.finish_command()
    await pacer.wait_command()
    assert clock.waits == [14]
