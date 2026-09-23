<!--
SCHEMA (read before editing)

Every resume item (a job, project, publication, cert, achievement, skill
group, or the summary) is a fenced `item` block with YAML-ish fields:

```item
id: short-unique-slug
title: Company/Org — Role, or Project Name   # optional; omit for summary/skills/certs
tags: [ml, systems, networking, backend, frontend, cloud, research]
dates: 2024-08 – present        # or a single date, or omit for skills/certs
keywords: [pytorch, kubernetes, tcp/ip]
bullets:
  - Achievement-oriented bullet, real and verifiable.
  - Another bullet.
```

`id` must be unique across the whole file. `title` is the human-readable
heading rendering shows above the item's bullets (e.g. "Acme Corp — SWE
Intern", "Multimodal Agentic AI System") — used for education/experience/
projects/publications; omit it for summary/skills/certifications, where the
bullet text already is the full display content. `tags` is a subset of the
list above — used by fit-scoring to shortlist items per job. `keywords` are
the literal terms ATS systems and the fit-scorer match against JD text.
Downstream tooling (Mark III) parses these fenced blocks; free-form prose
outside them is for human readability only and is ignored by tooling.

NEVER add a bullet, keyword, or metric that isn't true — see the
no-fabrication skill. This file is the single source of truth; tailoring
only selects/reorders/rewords what's here.

YAML GOTCHA: a bullet containing ": " (e.g. "Paper ID: 206") gets misread
as a nested mapping unless the whole bullet is wrapped in double quotes,
like `- "text with: a colon"`.
-->

# Resume Profile

## Contact
- name: Jane Doe
- email: jane.doe@example.com
- phone: +1-000-000-0000
- location: Los Angeles, CA
- links: linkedin.com/in/janedoe, github.com/janedoe

## Summary
```item
id: summary-main
tags: [ml, systems, backend]
keywords: [machine learning, distributed systems, python]
bullets:
  - MSCS student with production experience in backend systems and applied ML, seeking SWE/ML internships.
```

## Education
```item
id: edu-usc-mscs
title: University of Southern California — M.S. Computer Science
tags: [ml, systems]
dates: 2024-08 – 2026-05
keywords: [computer science, machine learning, distributed systems]
bullets:
  - M.S. Computer Science, University of Southern California, GPA 3.9/4.0.
  - Relevant coursework: Distributed Systems, Machine Learning, Computer Networks.
```

## Experience
```item
id: exp-example-swe-intern
title: Example Corp — Software Engineering Intern
tags: [backend, cloud]
dates: 2024-05 – 2024-08
keywords: [python, aws, ci/cd, rest api]
bullets:
  - Built a REST API in Python serving 10k req/day, reducing p95 latency 30% via query caching.
  - Set up CI/CD pipeline on AWS, cutting deploy time from 40 to 8 minutes.
```

## Research
```item
id: research-example-lab
tags: [ml, research]
dates: 2023-09 – 2024-05
keywords: [pytorch, nlp, transformers]
bullets:
  - Trained transformer-based models for text classification, published results in a peer-reviewed workshop.
```

## Projects
```item
id: project-example-networking
tags: [networking, systems]
dates: 2023
keywords: [tcp, sockets, c]
bullets:
  - Implemented a reliable transport protocol over UDP in C, achieving 95% of TCP throughput on lossy links.
```

## Skills
```item
id: skills-languages
tags: [backend, systems]
keywords: [python, c, c++, java]
bullets:
  - "Languages: Python, C, C++, Java"
```
```item
id: skills-ml
tags: [ml]
keywords: [pytorch, tensorflow, scikit-learn]
bullets:
  - "ML: PyTorch, TensorFlow, scikit-learn"
```
```item
id: skills-cloud
tags: [cloud, systems]
keywords: [aws, docker, kubernetes]
bullets:
  - "Cloud/Infra: AWS, Docker, Kubernetes"
```

## Certifications
```item
id: cert-example
tags: [cloud]
dates: 2024
keywords: [aws certified]
bullets:
  - AWS Certified Cloud Practitioner (2024).
```

## Achievements
```item
id: achievement-example
tags: [research]
dates: 2023
keywords: [hackathon]
bullets:
  - 1st place, Example University Hackathon (2023), among 40 teams.
```

## Publications
```item
id: publication-example
tags: [research, ml]
dates: 2024
keywords: [workshop paper]
bullets:
  - J. Doe, "Example Paper Title," Example Workshop, 2024.
```
