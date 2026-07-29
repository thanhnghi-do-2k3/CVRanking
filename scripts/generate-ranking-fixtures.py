#!/usr/bin/env python3
"""Generate local JD and CV fixtures for the public ranking test page."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from textwrap import wrap


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "frontend" / "public" / "ranking-fixtures"
JOBS_DIR = OUTPUT_ROOT / "jobs"
CVS_DIR = OUTPUT_ROOT / "cvs"


JOBS = [
    {
        "id": "backend-go",
        "title": "Senior Backend Engineer",
        "description": "\n".join(
            [
                "About the role",
                "We are hiring a Senior Backend Engineer to own high-volume production services for an internal hiring intelligence platform.",
                "",
                "Key responsibilities",
                "- Design and maintain REST APIs, background jobs and service integrations.",
                "- Improve PostgreSQL performance, Redis caching and production observability.",
                "- Partner with product and data teams to ship reliable recruiter workflows.",
                "",
                "Requirements",
                "- 5+ years building production backend systems.",
                "- Strong experience with Go, PostgreSQL, Docker, Redis and REST API design.",
                "- Comfortable debugging performance, reliability and database bottlenecks.",
                "",
                "Nice to have",
                "- Kubernetes, AWS and experience operating multi-service platforms.",
            ],
        ),
        "expected_top": "01-alex-strong-backend.pdf",
    },
    {
        "id": "ml-python",
        "title": "Machine Learning Engineer",
        "description": "\n".join(
            [
                "About the role",
                "We are hiring a Machine Learning Engineer to build document understanding, extraction and candidate ranking workflows.",
                "",
                "Key responsibilities",
                "- Build NLP, classification and semantic ranking pipelines for production use cases.",
                "- Design offline model evaluation, data quality checks and monitoring loops.",
                "- Package ML capabilities behind reliable APIs for product teams.",
                "",
                "Requirements",
                "- 4+ years shipping machine learning or data products.",
                "- Strong Python, SQL, NLP and model evaluation experience.",
                "- Hands-on PyTorch or TensorFlow plus Docker-based deployment.",
                "",
                "Nice to have",
                "- AWS, document AI, resume parsing or search/recommendation systems.",
            ],
        ),
        "expected_top": "05-minh-ml-engineer.pdf",
    },
    {
        "id": "fullstack-react",
        "title": "Full-stack Product Engineer",
        "description": "\n".join(
            [
                "About the role",
                "We are hiring a Full-stack Product Engineer to craft polished recruiter workflows from UI to backend services.",
                "",
                "Key responsibilities",
                "- Build React and TypeScript dashboards, forms and review flows.",
                "- Implement Node.js REST APIs, PostgreSQL-backed features and integrations.",
                "- Collaborate closely with product design to ship accessible internal tools.",
                "",
                "Requirements",
                "- 3+ years building production web applications.",
                "- Strong React, TypeScript, Node.js, REST APIs and PostgreSQL.",
                "- Comfortable with testing, debugging and pragmatic product trade-offs.",
                "",
                "Nice to have",
                "- Docker, accessibility systems and experience with admin/workflow products.",
            ],
        ),
        "expected_top": "08-sara-fullstack.pdf",
    },
    {
        "id": "qa-automation",
        "title": "QA Automation Engineer",
        "description": "\n".join(
            [
                "About the role",
                "We are hiring a QA Automation Engineer to raise release confidence across recruiter-facing web applications.",
                "",
                "Key responsibilities",
                "- Own Playwright regression suites, API testing and release quality gates.",
                "- Reduce flaky tests, improve CI feedback and coordinate bug triage.",
                "- Define practical test plans for complex product workflows.",
                "",
                "Requirements",
                "- 3+ years testing production web applications.",
                "- Strong Playwright, API testing, test planning and CI experience.",
                "- Comfortable writing automation in TypeScript.",
                "",
                "Nice to have",
                "- Docker, accessibility checks and lightweight performance smoke testing.",
            ],
        ),
        "expected_top": "09-tuan-qa-automation.pdf",
    },
    {
        "id": "product-manager",
        "title": "Product Manager",
        "description": "\n".join(
            [
                "About the role",
                "We are hiring a Product Manager to lead discovery and roadmap execution for B2B workflow products.",
                "",
                "Key responsibilities",
                "- Run customer interviews, synthesize problems and define product requirements.",
                "- Prioritize roadmap bets with analytics, stakeholder input and delivery constraints.",
                "- Coordinate design, engineering and go-to-market partners for launches.",
                "",
                "Requirements",
                "- 5+ years building B2B software products.",
                "- Strong discovery, roadmap planning, stakeholder alignment and analytics.",
                "- Comfortable using SQL or product data to make prioritization decisions.",
                "",
                "Nice to have",
                "- SaaS dashboards, experimentation and enterprise workflow experience.",
            ],
        ),
        "expected_top": "11-hanh-product-manager.pdf",
    },
    {
        "id": "data-engineer",
        "title": "Data Engineer",
        "description": "\n".join(
            [
                "About the role",
                "We are hiring a Data Engineer to build trusted data pipelines and analytics-ready models for hiring operations.",
                "",
                "Key responsibilities",
                "- Build batch and streaming pipelines with clear ownership and observability.",
                "- Implement data quality checks, warehouse models and downstream datasets.",
                "- Partner with analytics and product teams to improve decision-making data.",
                "",
                "Requirements",
                "- 4+ years shipping production data platforms.",
                "- Strong Python, SQL, data pipelines, Airflow and cloud warehouse experience.",
                "- Practical understanding of reliability, lineage and operational monitoring.",
                "",
                "Nice to have",
                "- Spark, dbt, Docker and AWS production experience.",
            ],
        ),
        "expected_top": "13-anh-data-engineer.pdf",
    },
]


CVS = [
    {
        "name": "01-alex-strong-backend.pdf",
        "candidate": "Alex Nguyen",
        "lines": [
            "Alex Nguyen",
            "Senior Backend Engineer",
            "8 years experience building production backend services.",
            "Skills: Go, PostgreSQL, Docker, Redis, REST APIs, Kubernetes, AWS, observability.",
            "Led Go microservices with PostgreSQL, Redis cache, Docker deployment and REST API design.",
            "Improved database performance and reliability for high-volume SaaS services.",
        ],
    },
    {
        "name": "02-binh-mid-backend.pdf",
        "candidate": "Binh Tran",
        "lines": [
            "Binh Tran",
            "Backend Developer",
            "4 years experience in backend systems.",
            "Skills: Python, PostgreSQL, Docker, REST APIs, FastAPI, Celery.",
            "Built API services, reporting jobs and PostgreSQL schemas for internal platforms.",
            "Some exposure to Go, Redis and cloud deployments.",
        ],
    },
    {
        "name": "03-chris-frontend.pdf",
        "candidate": "Chris Le",
        "lines": [
            "Chris Le",
            "Frontend Developer",
            "3 years experience building web interfaces.",
            "Skills: React, TypeScript, CSS, Figma, accessibility, component libraries.",
            "Built dashboards and design systems for customer portals.",
            "Limited backend experience beyond simple API integration.",
        ],
    },
    {
        "name": "04-dana-devops.pdf",
        "candidate": "Dana Pham",
        "lines": [
            "Dana Pham",
            "DevOps Engineer",
            "6 years experience running cloud infrastructure.",
            "Skills: AWS, Kubernetes, Docker, Terraform, Prometheus, incident response.",
            "Managed production clusters, CI/CD pipelines and service observability.",
            "Less hands-on with application code, Go or product API design.",
        ],
    },
    {
        "name": "05-minh-ml-engineer.pdf",
        "candidate": "Minh Vo",
        "lines": [
            "Minh Vo",
            "Machine Learning Engineer",
            "6 years experience shipping machine learning systems.",
            "Skills: Python, SQL, NLP, PyTorch, TensorFlow, model evaluation, Docker, AWS.",
            "Built resume parsing, semantic ranking and classification pipelines for production products.",
            "Designed offline evaluation, feature quality checks and API deployment for ML services.",
        ],
    },
    {
        "name": "06-linh-data-analyst.pdf",
        "candidate": "Linh Hoang",
        "lines": [
            "Linh Hoang",
            "Data Analyst",
            "4 years experience in analytics and business intelligence.",
            "Skills: SQL, Python, dashboards, data cleaning, experimentation, stakeholder reporting.",
            "Built product metrics, retention cohorts and lightweight predictive notebooks.",
            "Limited experience with NLP models, PyTorch and production ML deployment.",
        ],
    },
    {
        "name": "07-quan-java-backend.pdf",
        "candidate": "Quan Dang",
        "lines": [
            "Quan Dang",
            "Java Backend Engineer",
            "5 years experience building enterprise backend services.",
            "Skills: Java, Spring Boot, MySQL, Kafka, REST APIs, Docker.",
            "Built payment APIs, batch processing and event-driven services.",
            "No direct experience with Go, NLP or React product interfaces.",
        ],
    },
    {
        "name": "08-sara-fullstack.pdf",
        "candidate": "Sara Nguyen",
        "lines": [
            "Sara Nguyen",
            "Full-stack Product Engineer",
            "5 years experience building production web applications.",
            "Skills: React, TypeScript, Node.js, PostgreSQL, REST APIs, Docker, testing, accessibility.",
            "Built admin dashboards, onboarding flows and backend services for SaaS products.",
            "Strong collaboration with product design and customer support teams.",
        ],
    },
    {
        "name": "09-tuan-qa-automation.pdf",
        "candidate": "Tuan Pham",
        "lines": [
            "Tuan Pham",
            "QA Automation Engineer",
            "5 years experience testing production web applications.",
            "Skills: Playwright, TypeScript, API testing, CI, Docker, accessibility checks, regression suites.",
            "Built automated release quality gates and reduced flaky tests for SaaS dashboards.",
            "Collaborated with engineers and product managers on bug triage and test planning.",
        ],
    },
    {
        "name": "10-mai-manual-qa.pdf",
        "candidate": "Mai Le",
        "lines": [
            "Mai Le",
            "Manual QA Analyst",
            "4 years experience in exploratory testing and release verification.",
            "Skills: test cases, bug reports, Jira, regression testing, stakeholder communication.",
            "Strong manual testing background for mobile and web products.",
            "Limited experience with Playwright, TypeScript and automated CI pipelines.",
        ],
    },
    {
        "name": "11-hanh-product-manager.pdf",
        "candidate": "Hanh Bui",
        "lines": [
            "Hanh Bui",
            "Senior Product Manager",
            "7 years experience building B2B SaaS products.",
            "Skills: discovery, roadmap planning, prioritization, analytics, SQL, experimentation, go-to-market.",
            "Led customer interviews, product requirements and dashboard strategy with design and engineering teams.",
            "Owned stakeholder alignment and launch planning for enterprise workflow products.",
        ],
    },
    {
        "name": "12-nam-project-manager.pdf",
        "candidate": "Nam Do",
        "lines": [
            "Nam Do",
            "Project Manager",
            "6 years experience coordinating delivery teams.",
            "Skills: Agile, Scrum, stakeholder updates, risk tracking, release planning.",
            "Managed timelines and cross-functional communication for enterprise implementations.",
            "Less experience with product discovery, SQL analytics and roadmap ownership.",
        ],
    },
    {
        "name": "13-anh-data-engineer.pdf",
        "candidate": "Anh Tran",
        "lines": [
            "Anh Tran",
            "Data Engineer",
            "6 years experience shipping production data platforms.",
            "Skills: Python, SQL, Airflow, Spark, dbt, AWS, Docker, data quality checks.",
            "Built batch and streaming pipelines, warehouse models and analytics-ready datasets.",
            "Owned observability and reliability for cloud data pipelines.",
        ],
    },
    {
        "name": "14-vy-bi-engineer.pdf",
        "candidate": "Vy Nguyen",
        "lines": [
            "Vy Nguyen",
            "BI Engineer",
            "4 years experience building analytics dashboards.",
            "Skills: SQL, dbt, Looker, Tableau, data modeling, stakeholder reporting.",
            "Built executive dashboards and semantic models for sales and product analytics.",
            "Some Python exposure but limited Airflow, Spark and production pipeline ownership.",
        ],
    },
]


SETS = [
    {
        "id": "backend-go",
        "name": "Backend Go/PostgreSQL",
        "description": "JD backend senior; expected top candidate: Alex Nguyen.",
        "job_id": "backend-go",
        "cv_names": [
            "01-alex-strong-backend.pdf",
            "02-binh-mid-backend.pdf",
            "04-dana-devops.pdf",
            "03-chris-frontend.pdf",
        ],
    },
    {
        "id": "ml-python",
        "name": "ML Python/NLP",
        "description": "JD machine learning; expected top candidate: Minh Vo.",
        "job_id": "ml-python",
        "cv_names": [
            "05-minh-ml-engineer.pdf",
            "06-linh-data-analyst.pdf",
            "02-binh-mid-backend.pdf",
            "07-quan-java-backend.pdf",
        ],
    },
    {
        "id": "fullstack-react",
        "name": "Full-stack React/Node",
        "description": "JD full-stack product; expected top candidate: Sara Nguyen.",
        "job_id": "fullstack-react",
        "cv_names": [
            "08-sara-fullstack.pdf",
            "03-chris-frontend.pdf",
            "02-binh-mid-backend.pdf",
            "07-quan-java-backend.pdf",
        ],
    },
    {
        "id": "qa-automation",
        "name": "QA Automation",
        "description": "JD QA automation; expected top candidate: Tuan Pham.",
        "job_id": "qa-automation",
        "cv_names": [
            "09-tuan-qa-automation.pdf",
            "10-mai-manual-qa.pdf",
            "03-chris-frontend.pdf",
            "08-sara-fullstack.pdf",
        ],
    },
    {
        "id": "product-manager",
        "name": "Product Manager",
        "description": "JD product manager; expected top candidate: Hanh Bui.",
        "job_id": "product-manager",
        "cv_names": [
            "11-hanh-product-manager.pdf",
            "12-nam-project-manager.pdf",
            "08-sara-fullstack.pdf",
            "06-linh-data-analyst.pdf",
        ],
    },
    {
        "id": "data-engineer",
        "name": "Data Engineer",
        "description": "JD data engineer; expected top candidate: Anh Tran.",
        "job_id": "data-engineer",
        "cv_names": [
            "13-anh-data-engineer.pdf",
            "14-vy-bi-engineer.pdf",
            "05-minh-ml-engineer.pdf",
            "06-linh-data-analyst.pdf",
        ],
    },
]


def escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf_text(x: int, y: int, text: str, font: str = "F1", size: int = 11, color: tuple[float, float, float] = (0.11, 0.16, 0.25)) -> str:
    r, g, b = color
    return f"BT /{font} {size} Tf {r:.3f} {g:.3f} {b:.3f} rg {x} {y} Td ({escape_pdf_text(text)}) Tj ET"


def make_pdf(lines: list[str]) -> bytes:
    name = lines[0]
    title = lines[1]
    experience = lines[2]
    skills_line = next((line for line in lines if line.startswith("Skills:")), "Skills: Communication, ownership, collaboration")
    skills = [skill.strip().rstrip(".") for skill in skills_line.replace("Skills:", "").split(",")]
    impact_lines = [line for line in lines[3:] if not line.startswith("Skills:")]
    first_name = name.split()[0].lower()

    text_ops = [
        "0.973 0.980 0.992 rg 0 0 595 842 re f",
        "0.071 0.125 0.243 rg 0 724 595 118 re f",
        "0.145 0.388 0.922 rg 38 690 96 8 re f",
        pdf_text(38, 786, name, "F2", 28, (1, 1, 1)),
        pdf_text(40, 762, title, "F1", 13, (0.816, 0.878, 1)),
        pdf_text(40, 742, f"{first_name}@example.com  -  Ho Chi Minh City  -  Available in 30 days", "F1", 9, (0.710, 0.784, 0.910)),
        "1 1 1 rg 34 596 186 96 re f",
        "0.898 0.918 0.953 RG 34 596 186 96 re S",
        pdf_text(52, 668, "PROFILE", "F2", 10, (0.145, 0.388, 0.922)),
        "1 1 1 rg 240 596 320 96 re f",
        "0.898 0.918 0.953 RG 240 596 320 96 re S",
        pdf_text(258, 668, "SELECTED IMPACT", "F2", 10, (0.145, 0.388, 0.922)),
    ]

    profile_y = 646
    for wrapped in wrap(experience, width=34)[:3]:
        text_ops.append(pdf_text(52, profile_y, wrapped, "F1", 10, (0.208, 0.254, 0.333)))
        profile_y -= 17

    y = 646
    for line in impact_lines[:2]:
        for wrapped in wrap(f"- {line}", width=76)[:2]:
            text_ops.append(pdf_text(258, y, wrapped, "F1", 9, (0.208, 0.254, 0.333)))
            y -= 16

    text_ops.extend(
        [
            pdf_text(38, 548, "CORE SKILLS", "F2", 11, (0.145, 0.388, 0.922)),
            "0.898 0.918 0.953 RG 38 535 520 1 re S",
        ],
    )

    x = 38
    y = 506
    for skill in skills[:10]:
        width = max(64, min(132, len(skill) * 6 + 24))
        if x + width > 558:
            x = 38
            y -= 34
        text_ops.append(f"0.937 0.965 1 rg {x} {y - 7} {width} 24 re f")
        text_ops.append(f"0.745 0.839 1 RG {x} {y - 7} {width} 24 re S")
        text_ops.append(pdf_text(x + 12, y, skill, "F2", 9, (0.114, 0.306, 0.847)))
        x += width + 10

    text_ops.extend(
        [
            pdf_text(38, 410, "EXPERIENCE HIGHLIGHTS", "F2", 11, (0.145, 0.388, 0.922)),
            "0.898 0.918 0.953 RG 38 397 520 1 re S",
        ],
    )

    y = 368
    for line in lines[2:]:
        if line.startswith("Skills:"):
            continue
        for wrapped in wrap(f"- {line}", width=108)[:2]:
            text_ops.append(pdf_text(52, y, wrapped, "F1", 10, (0.208, 0.254, 0.333)))
            y -= 20

    text_ops.extend(
        [
            pdf_text(38, 238, "SIGNALS FOR TALENTRANK", "F2", 11, (0.145, 0.388, 0.922)),
            "0.898 0.918 0.953 RG 38 225 520 1 re S",
            pdf_text(52, 198, "Evidence-rich resume with role title, years of experience, skills, and impact statements.", "F1", 10, (0.208, 0.254, 0.333)),
            pdf_text(52, 176, "Designed for local ranking tests while remaining readable in CV preview.", "F1", 10, (0.208, 0.254, 0.333)),
        ],
    )

    stream = "\n".join(text_ops)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        f"<< /Length {len(stream.encode('utf-8'))} >>\nstream\n{stream}\nendstream",
    ]
    pdf = "%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects):
        offsets.append(len(pdf.encode("utf-8")))
        pdf += f"{index + 1} 0 obj\n{obj}\nendobj\n"
    xref = len(pdf.encode("utf-8"))
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return pdf.encode("utf-8")


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    CVS_DIR.mkdir(parents=True, exist_ok=True)

    for old_path in JOBS_DIR.glob("*.json"):
        old_path.unlink()
    for old_path in CVS_DIR.glob("*.pdf"):
        old_path.unlink()

    jobs_by_id = {job["id"]: job for job in JOBS}
    cvs_by_name = {cv["name"]: cv for cv in CVS}

    for job in JOBS:
        write_json(JOBS_DIR / f"{job['id']}.json", job)

    for cv in CVS:
        (CVS_DIR / cv["name"]).write_bytes(make_pdf(cv["lines"]))

    manifest_sets = []
    for fixture_set in SETS:
        job = jobs_by_id[fixture_set["job_id"]]
        manifest_sets.append(
            {
                "id": fixture_set["id"],
                "name": fixture_set["name"],
                "description": fixture_set["description"],
                "job_config_path": f"/ranking-fixtures/jobs/{job['id']}.json",
                "expected_top": job["expected_top"],
                "cvs": [
                    {
                        "name": cv_name,
                        "candidate": cvs_by_name[cv_name]["candidate"],
                        "path": f"/ranking-fixtures/cvs/{cv_name}",
                    }
                    for cv_name in fixture_set["cv_names"]
                ],
            },
        )

    write_json(
        OUTPUT_ROOT / "manifest.json",
        {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "sets": manifest_sets,
        },
    )

    print(f"Generated {len(JOBS)} JD configs and {len(CVS)} CV PDFs in {OUTPUT_ROOT}")


if __name__ == "__main__":
    main()
