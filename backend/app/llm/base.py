"""Provider-agnostic LLM interface, selected at runtime by LLM_PROVIDER
(gemini/groq/claude) via llm/factory.py."""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    def complete(self, prompt: str) -> str:
        """Return a completion for the given prompt."""
