import threading
import time


class RateLimiter:
    """Simple sliding-window limiter: blocks (sleeps) so no more than
    max_calls happen within period_seconds. Conservative default keeps
    Mark II under free-tier LLM quotas without needing a real queue."""

    def __init__(self, max_calls: int, period_seconds: float = 60.0):
        self.max_calls = max_calls
        self.period_seconds = period_seconds
        self._calls: list[float] = []
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            self._calls = [t for t in self._calls if now - t < self.period_seconds]
            if len(self._calls) >= self.max_calls:
                sleep_for = self.period_seconds - (now - self._calls[0])
                if sleep_for > 0:
                    time.sleep(sleep_for)
                now = time.monotonic()
                self._calls = [t for t in self._calls if now - t < self.period_seconds]
            self._calls.append(time.monotonic())
