from app.config import settings
from app.llm.base import LLMProvider


class _UnimplementedProvider(LLMProvider):
    def __init__(self, name: str):
        self.name = name

    def complete(self, prompt: str) -> str:
        raise NotImplementedError(f"LLM provider '{self.name}' is not implemented yet")


def get_llm_provider() -> LLMProvider:
    provider = settings.llm_provider.lower()
    if provider == "gemini":
        from app.llm.gemini import GeminiProvider

        return GeminiProvider()
    if provider in ("groq", "claude"):
        return _UnimplementedProvider(provider)
    raise ValueError(f"Unknown LLM_PROVIDER: {settings.llm_provider}")
