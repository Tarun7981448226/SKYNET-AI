from pydantic import BaseModel, Field

from app.resume.schema import Contact


class TailoredItem(BaseModel):
    id: str
    section: str
    title: str | None = None
    dates: str | None = None
    bullets: list[str] = Field(default_factory=list)


class TailoredResumeContent(BaseModel):
    """Output of tailor_resume(): a filtered, reordered, reworded view of
    ResumeProfile for one specific job. Every bullet here must already exist
    (verbatim or truthfully reworded) in data/resume.md — see no-fabrication."""

    job_id: int
    contact: Contact
    summary: list[TailoredItem] = Field(default_factory=list)
    education: list[TailoredItem] = Field(default_factory=list)
    experience: list[TailoredItem] = Field(default_factory=list)
    projects: list[TailoredItem] = Field(default_factory=list)
    skills: list[TailoredItem] = Field(default_factory=list)
    certifications: list[TailoredItem] = Field(default_factory=list)
    achievements: list[TailoredItem] = Field(default_factory=list)
    publications: list[TailoredItem] = Field(default_factory=list)

    def sections(self) -> list[tuple[str, list[TailoredItem]]]:
        """Ordered (heading, items) pairs for rendering — only non-empty sections."""
        pairs = [
            ("Summary", self.summary),
            ("Education", self.education),
            ("Experience", self.experience),
            ("Projects", self.projects),
            ("Skills", self.skills),
            ("Certifications", self.certifications),
            ("Achievements", self.achievements),
            ("Publications", self.publications),
        ]
        return [(heading, items) for heading, items in pairs if items]
