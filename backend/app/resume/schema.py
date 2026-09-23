from pydantic import BaseModel, Field, field_validator


class ResumeItem(BaseModel):
    """One `item` block from data/resume.md."""

    id: str
    section: str = ""  # set by the loader from the ## heading it was found under
    title: str | None = None  # human-readable display title, e.g. "Company — Role"
    tags: list[str] = Field(default_factory=list)
    dates: str | None = None
    keywords: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)

    @field_validator("dates", mode="before")
    @classmethod
    def _coerce_dates_to_str(cls, value: object) -> object:
        # YAML parses a bare year ("dates: 2023") as an int, not a string.
        return str(value) if isinstance(value, int) else value


class Contact(BaseModel):
    name: str
    email: str
    phone: str | None = None
    location: str | None = None
    links: list[str] = Field(default_factory=list)


class ResumeProfile(BaseModel):
    """Parsed form of data/resume.md — the single source of truth for
    scoring and tailoring. Never mutated; tailoring only selects/reorders/
    rewords items already present here (see no-fabrication skill)."""

    contact: Contact
    summary: list[ResumeItem] = Field(default_factory=list)
    education: list[ResumeItem] = Field(default_factory=list)
    experience: list[ResumeItem] = Field(default_factory=list)
    research: list[ResumeItem] = Field(default_factory=list)
    projects: list[ResumeItem] = Field(default_factory=list)
    skills: list[ResumeItem] = Field(default_factory=list)
    certifications: list[ResumeItem] = Field(default_factory=list)
    achievements: list[ResumeItem] = Field(default_factory=list)
    publications: list[ResumeItem] = Field(default_factory=list)

    def all_items(self) -> list[ResumeItem]:
        return (
            self.summary
            + self.education
            + self.experience
            + self.research
            + self.projects
            + self.skills
            + self.certifications
            + self.achievements
            + self.publications
        )

    def item_by_id(self, item_id: str) -> ResumeItem | None:
        for item in self.all_items():
            if item.id == item_id:
                return item
        return None
