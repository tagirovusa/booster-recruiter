"""Conservative browser pacing; never solves challenges or retries blocked actions."""

import asyncio
import random
import time


class BrowserPacer:
    """One worker's sequential commands, with gaps measured after completion."""

    def __init__(self, *, clock=None, uniform=None, sleep=None):
        self.clock = clock or time.monotonic
        self.uniform = uniform or random.uniform
        self.sleep = sleep or asyncio.sleep
        self.next_command_at = None

    async def wait_command(self):
        if self.next_command_at is not None:
            remaining = self.next_command_at - self.clock()
            if remaining > 0:
                await self.sleep(remaining)

    def finish_command(self):
        # A slow page load must not consume the rest period before the next
        # operation. Errors receive the same gap; they never cause a quick retry.
        self.next_command_at = self.clock() + self.uniform(8.0, 14.0)

    async def step(self):
        await self.sleep(self.uniform(1.5, 3.5))

    async def before_submit(self):
        # Callers revalidate recipient, exact draft and pricing AFTER this wait.
        await self.sleep(self.uniform(2.0, 4.0))
