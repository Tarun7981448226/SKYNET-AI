import pytest

from app.resume.loader import ResumeParseError, load_resume

FIXTURE = """\
# Resume Profile

## Contact
- name: Jane Doe
- email: jane@example.com
- phone: +1-000-000-0000
- location: Los Angeles, CA
- links: linkedin.com/in/janedoe, github.com/janedoe

## Summary
```item
id: summary-main
tags: [ml, backend]
keywords: [python, machine learning]
bullets:
  - MSCS student with applied ML and backend experience.
```

## Education
```item
id: edu-usc
tags: [ml]
dates: 2024-08 – 2026-05
keywords: [computer science]
bullets:
  - M.S. Computer Science, USC.
```

## Projects
```item
id: project-one
tags: [networking, systems]
dates: 2023
keywords: [tcp, sockets]
bullets:
  - Built a reliable transport protocol over UDP.
  - Achieved 95% of TCP throughput.
```
```item
id: project-two
tags: [ml]
dates: 2024
keywords: [pytorch]
bullets:
  - Trained a classifier with PyTorch.
```

## Skills
```item
id: skills-languages
tags: [backend]
keywords: [python, c]
bullets:
  - "Languages: Python, C"
```
"""


def test_load_resume(tmp_path):
    resume_path = tmp_path / "resume.md"
    resume_path.write_text(FIXTURE)

    profile = load_resume(resume_path)

    assert profile.contact.name == "Jane Doe"
    assert profile.contact.email == "jane@example.com"
    assert profile.contact.links == ["linkedin.com/in/janedoe", "github.com/janedoe"]

    assert len(profile.summary) == 1
    assert profile.summary[0].id == "summary-main"
    assert profile.summary[0].section == "summary"

    assert len(profile.projects) == 2
    assert profile.projects[0].id == "project-one"
    assert profile.projects[0].bullets == [
        "Built a reliable transport protocol over UDP.",
        "Achieved 95% of TCP throughput.",
    ]

    assert profile.item_by_id("project-two").tags == ["ml"]
    assert profile.item_by_id("nonexistent") is None

    all_ids = {item.id for item in profile.all_items()}
    assert all_ids == {"summary-main", "edu-usc", "project-one", "project-two", "skills-languages"}


def test_load_resume_missing_contact(tmp_path):
    resume_path = tmp_path / "resume.md"
    resume_path.write_text("# Resume Profile\n\n## Summary\n```item\nid: x\nbullets: []\n```\n")

    with pytest.raises(ResumeParseError):
        load_resume(resume_path)


def test_load_resume_duplicate_ids(tmp_path):
    resume_path = tmp_path / "resume.md"
    resume_path.write_text(
        "# Resume Profile\n\n## Contact\n- name: A\n- email: a@example.com\n\n"
        "## Projects\n```item\nid: dup\nbullets: []\n```\n```item\nid: dup\nbullets: []\n```\n"
    )

    with pytest.raises(ResumeParseError):
        load_resume(resume_path)
