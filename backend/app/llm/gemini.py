import logging

from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.cache import get_cached, set_cached
from app.llm.rate_limit import RateLimiter

logger = logging.getLogger(__name__)


def _is_retryable(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "429" in message or "resource_exhausted" in message or "503" in message or "unavailable" in message


class GeminiProvider(LLMProvider):
    def __init__(self, model: str = "gemini-flash-lite-latest"):
        self.model_name = model
        self._rate_limiter = RateLimiter(max_calls=settings.gemini_rate_limit_rpm, period_seconds=60.0)
        self._model = None

    def _get_model(self):
        if self._model is None:
            import google.generativeai as genai

            genai.configure(api_key=settings.gemini_api_key)
            self._model = genai.GenerativeModel(self.model_name)
        return self._model

    def complete(self, prompt: str) -> str:
        cached = get_cached(prompt)
        if cached is not None:
            return cached

        response = self._complete_with_retry(prompt)
        set_cached(prompt, response)
        return response

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=5, max=60),
        reraise=True,
    )
    def _complete_with_retry(self, prompt: str) -> str:
        self._rate_limiter.wait()
        model = self._get_model()
        result = model.generate_content(prompt)
        return result.text
