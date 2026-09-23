from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date


@dataclass
class RawJobPosting:
    source_name: str
    external_id: str
    raw_text: str
    url: str | None = None
    posted_date: date | None = None  # from the source's own structured metadata, if available
    deadline: date | None = None  # ditto — preferred over the LLM's prose-based guess when present


class SourceAdapter(ABC):
    """Plugin interface every job source implements. See the
    source-adapters skill for the full contract (read-only, own
    rate-limiting, no pipeline changes required per-adapter)."""

    @abstractmethod
    def fetch(self) -> list[RawJobPosting]:
        """Return new postings since the last run."""

    @abstractmethod
    def dedupe_key(self, posting: RawJobPosting) -> str:
        """Stable key used to prevent reprocessing the same posting."""
