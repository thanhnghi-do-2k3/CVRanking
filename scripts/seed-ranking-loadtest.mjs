#!/usr/bin/env node

const baseURL = process.env.RANKING_DEMO_URL ?? process.argv[2] ?? "http://localhost:3000";
const totalCVs = Number.parseInt(process.env.RANKING_LOAD_COUNT ?? process.argv[3] ?? "150", 10);
const batchSize = 50;

const jd = {
  title: `Senior Backend Engineer — Load Test ${totalCVs} CV`,
  description: [
    "About the role",
    "We are hiring a Senior Backend Engineer to own high-volume production services for an internal hiring intelligence platform.",
    "",
    "Key responsibilities",
    "- Design and maintain REST APIs, background jobs and service integrations.",
    "- Improve PostgreSQL performance, Redis caching and production observability.",
    "- Partner with product and data teams to ship reliable recruiter workflows.",
    "",
    "Requirements",
    "- Minimum 5+ years building production backend systems.",
    "- Strong experience with Go, PostgreSQL, Docker, Redis and REST API design.",
    "- Comfortable debugging performance, reliability and database bottlenecks.",
    "",
    "Nice to have",
    "- Kubernetes, AWS and experience operating multi-service platforms.",
  ].join("\n"),
};

const firstNames = [
  "An",
  "Binh",
  "Chi",
  "Duc",
  "Giang",
  "Hieu",
  "Khanh",
  "Lan",
  "Minh",
  "Nam",
  "Oanh",
  "Phuc",
  "Quang",
  "Trang",
  "Vy",
  "Yen",
];

const lastNames = [
  "Nguyen",
  "Tran",
  "Le",
  "Pham",
  "Hoang",
  "Vo",
  "Dang",
  "Bui",
  "Do",
  "Phan",
];

function escapePDFText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pdfText(x, y, text, font = "F1", size = 10, color = [0.11, 0.16, 0.25]) {
  const [r, g, b] = color;
  return `BT /${font} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x} ${y} Td (${escapePDFText(text)}) Tj ET`;
}

function wrapText(value, width) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function makePDF(lines) {
  const name = lines[0];
  const title = lines[1];
  const experience = lines[2];
  const skillsLine = lines.find((line) => line.startsWith("Skills:")) ?? "Skills: Communication, ownership";
  const skills = skillsLine.replace("Skills:", "").split(",").map((skill) => skill.trim()).filter(Boolean);
  const impactLines = lines.slice(3).filter((line) => !line.startsWith("Skills:"));
  const firstName = name.split(" ")[0].toLowerCase();
  const textOps = [
    "0.973 0.980 0.992 rg 0 0 595 842 re f",
    "0.071 0.125 0.243 rg 0 724 595 118 re f",
    "0.145 0.388 0.922 rg 38 690 96 8 re f",
    pdfText(38, 786, name, "F2", 27, [1, 1, 1]),
    pdfText(40, 762, title, "F1", 13, [0.816, 0.878, 1]),
    pdfText(40, 742, `${firstName}@loadtest.example.com  -  Ho Chi Minh City  -  Available in 30 days`, "F1", 9, [0.71, 0.784, 0.91]),
    "1 1 1 rg 34 596 186 96 re f",
    "0.898 0.918 0.953 RG 34 596 186 96 re S",
    pdfText(52, 668, "PROFILE", "F2", 10, [0.145, 0.388, 0.922]),
    "1 1 1 rg 240 596 320 96 re f",
    "0.898 0.918 0.953 RG 240 596 320 96 re S",
    pdfText(258, 668, "SELECTED IMPACT", "F2", 10, [0.145, 0.388, 0.922]),
  ];

  let profileY = 646;
  for (const wrapped of wrapText(experience, 34).slice(0, 3)) {
    textOps.push(pdfText(52, profileY, wrapped, "F1", 10, [0.208, 0.254, 0.333]));
    profileY -= 17;
  }

  let impactY = 646;
  for (const line of impactLines.slice(0, 2)) {
    for (const wrapped of wrapText(`- ${line}`, 76).slice(0, 2)) {
      textOps.push(pdfText(258, impactY, wrapped, "F1", 9, [0.208, 0.254, 0.333]));
      impactY -= 16;
    }
  }

  textOps.push(
    pdfText(38, 548, "CORE SKILLS", "F2", 11, [0.145, 0.388, 0.922]),
    "0.898 0.918 0.953 RG 38 535 520 1 re S",
  );

  let x = 38;
  let y = 506;
  for (const skill of skills.slice(0, 12)) {
    const width = Math.max(64, Math.min(132, skill.length * 6 + 24));
    if (x + width > 558) {
      x = 38;
      y -= 34;
    }
    textOps.push(`0.937 0.965 1 rg ${x} ${y - 7} ${width} 24 re f`);
    textOps.push(`0.745 0.839 1 RG ${x} ${y - 7} ${width} 24 re S`);
    textOps.push(pdfText(x + 12, y, skill, "F2", 9, [0.114, 0.306, 0.847]));
    x += width + 10;
  }

  textOps.push(
    pdfText(38, 410, "EXPERIENCE HIGHLIGHTS", "F2", 11, [0.145, 0.388, 0.922]),
    "0.898 0.918 0.953 RG 38 397 520 1 re S",
  );

  let highlightY = 368;
  for (const line of lines.slice(2)) {
    if (line.startsWith("Skills:")) {
      continue;
    }
    for (const wrapped of wrapText(`- ${line}`, 108).slice(0, 2)) {
      textOps.push(pdfText(52, highlightY, wrapped, "F1", 10, [0.208, 0.254, 0.333]));
      highlightY -= 20;
    }
  }

  textOps.push(
    pdfText(38, 238, "SIGNALS FOR TALENTRANK", "F2", 11, [0.145, 0.388, 0.922]),
    "0.898 0.918 0.953 RG 38 225 520 1 re S",
    pdfText(52, 198, "Generated load-test resume with varied skill coverage for ranking stress demos.", "F1", 10, [0.208, 0.254, 0.333]),
    pdfText(52, 176, "The content remains parseable and evidence-rich for the local ranking pipeline.", "F1", 10, [0.208, 0.254, 0.333]),
  );

  const stream = textOps.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "utf-8");
}

function profileFor(index) {
  const name = `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]} ${String(index + 1).padStart(3, "0")}`;

  if (index < Math.min(6, totalCVs)) {
    const years = 7 + (index % 6);
    return {
      name,
      title: "Senior Backend Engineer",
      years,
      skills: ["Go", "PostgreSQL", "Docker", "Redis", "REST", "Kubernetes", "AWS", "Microservices", "Kafka"],
      impacts: [
        `Led Go services for ${years} years across high-volume APIs, PostgreSQL data models and Redis-backed workflows.`,
        "Improved API latency, database reliability and production observability for recruiter-facing platforms.",
      ],
    };
  }

  if (index < Math.round(totalCVs * 0.16)) {
    const years = 6 + (index % 5);
    const skillVariants = [
      ["Go", "PostgreSQL", "Docker", "Redis", "REST", "Kubernetes", "Microservices"],
      ["Go", "PostgreSQL", "Docker", "Redis", "REST", "AWS", "Kafka"],
      ["Go", "PostgreSQL", "Docker", "REST", "Kubernetes", "AWS"],
      ["Go", "PostgreSQL", "Redis", "REST", "Kubernetes", "AWS"],
    ];
    return {
      name,
      title: index % 3 === 0 ? "Senior Backend Engineer" : "Backend Platform Engineer",
      years,
      skills: skillVariants[index % skillVariants.length],
      impacts: [
        `${years} years experience owning Go services, production APIs and platform reliability.`,
        "Strong backend signal with one or two secondary requirements less explicit in the CV.",
      ],
    };
  }

  if (index < Math.round(totalCVs * 0.45)) {
    const years = 4 + (index % 4);
    return {
      name,
      title: "Backend Engineer",
      years,
      skills: index % 2 === 0
        ? ["Go", "PostgreSQL", "Docker", "REST", "Redis", "CI/CD"]
        : ["Go", "MySQL", "Docker", "REST", "Kafka", "Linux"],
      impacts: [
        `${years} years experience building backend APIs, background jobs and integration services.`,
        "Owned several production services with pragmatic monitoring and release practices.",
      ],
    };
  }

  if (index < Math.round(totalCVs * 0.65)) {
    const years = 5 + (index % 5);
    return {
      name,
      title: "DevOps Engineer",
      years,
      skills: ["AWS", "Kubernetes", "Docker", "Terraform", "Redis", "Linux", "CI/CD"],
      impacts: [
        `${years} years operating cloud infrastructure, Kubernetes clusters and deployment automation.`,
        "Strong production reliability background but less ownership of Go application code.",
      ],
    };
  }

  if (index < Math.round(totalCVs * 0.84)) {
    const years = 3 + (index % 5);
    return {
      name,
      title: "Python Backend Engineer",
      years,
      skills: ["Python", "PostgreSQL", "Docker", "REST", "FastAPI", "Redis", "AWS"],
      impacts: [
        `${years} years building Python APIs, reporting jobs and PostgreSQL-backed internal tools.`,
        "Some transferable backend experience but limited direct Go production ownership.",
      ],
    };
  }

  const years = 2 + (index % 4);
  return {
    name,
    title: index % 2 === 0 ? "Frontend Developer" : "QA Analyst",
    years,
    skills: index % 2 === 0
      ? ["React", "TypeScript", "CSS", "HTML", "Git"]
      : ["Playwright", "TypeScript", "API testing", "Jira", "Regression testing"],
    impacts: [
      `${years} years experience in adjacent product engineering work.`,
      "Useful collaboration background but few direct backend platform signals for this JD.",
    ],
  };
}

function makeCandidatePDF(index) {
  const profile = profileFor(index);
  const lines = [
    profile.name,
    profile.title,
    `${profile.years} years experience in production software teams.`,
    `Skills: ${profile.skills.join(", ")}.`,
    ...profile.impacts,
  ];
  return {
    filename: `${String(index + 1).padStart(3, "0")}-${profile.name.toLowerCase().replaceAll(" ", "-")}.pdf`,
    buffer: makePDF(lines),
  };
}

async function postForm(form) {
  const response = await fetch(`${baseURL}/api/ranking-test`, {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? `Request failed with ${response.status}`);
  }
  return payload;
}

async function createJob() {
  const form = new FormData();
  form.append("action", "create_job");
  form.append("title", jd.title);
  form.append("jd", jd.description);
  return postForm(form);
}

async function uploadBatch(jobID, start, end) {
  const form = new FormData();
  form.append("action", "upload_cvs");
  form.append("job_id", jobID);
  for (let index = start; index < end; index += 1) {
    const candidate = makeCandidatePDF(index);
    form.append("files", new Blob([candidate.buffer], { type: "application/pdf" }), candidate.filename);
  }
  return postForm(form);
}

async function runRanking(jobID) {
  const form = new FormData();
  form.append("action", "run_ranking");
  form.append("job_id", jobID);
  return postForm(form);
}

async function main() {
  if (!Number.isInteger(totalCVs) || totalCVs < 1 || totalCVs > 200) {
    throw new Error("RANKING_LOAD_COUNT must be between 1 and 200.");
  }

  const startedAt = Date.now();
  const created = await createJob();
  console.log(`Created JD: ${created.job.title}`);
  console.log(`URL: ${baseURL}/jobs/${created.job.id}`);

  let accepted = 0;
  for (let start = 0; start < totalCVs; start += batchSize) {
    const end = Math.min(start + batchSize, totalCVs);
    const uploaded = await uploadBatch(created.job.id, start, end);
    accepted += uploaded.upload.accepted;
    console.log(`Uploaded ${end}/${totalCVs} CV · accepted so far: ${accepted}`);
  }

  const rankingStarted = Date.now();
  const ranked = await runRanking(created.job.id);
  const rankingMs = Date.now() - rankingStarted;
  const totalMs = Date.now() - startedAt;
  const top = ranked.run.results?.slice(0, 10).map((result) => ({
    rank: result.rank,
    name: result.candidate.full_name,
    title: result.candidate.current_title,
    score: Math.round(result.final_score * 100),
  }));

  console.log(JSON.stringify({
    job_url: `${baseURL}/jobs/${created.job.id}`,
    cv_count: ranked.job.cv_count,
    ranking_ms: rankingMs,
    total_ms: totalMs,
    top_10: top,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
