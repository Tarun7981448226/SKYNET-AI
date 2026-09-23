from pydantic import BaseModel, Field


class FitScoreResult(BaseModel):
    """See the fit-scoring skill: score is a decision aid, never a gate —
    the caller must not auto-discard or auto-apply based on it."""

    score: int = Field(ge=0, le=100)
    matched_item_ids: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    rationale: str
    visa_flag: bool = False  # True if the JD states a citizenship/clearance/no-sponsorship requirement
