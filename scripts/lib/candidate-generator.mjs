// Shared candidate/PDF generator used by the seeding scripts (seed-ranking-loadtest.mjs,
// seed-ranking-variety.mjs). Pulls real names and real resumes from public, no-auth sources
// on every call and renders the *actual* resume markup (real section layout, not our own
// template) to a real PDF via a headless browser. Falls back to a local synthetic template
// only if the public sources are completely unreachable.

import { chromium } from "playwright-core";

const HF_DATASETS_SERVER = "https://datasets-server.huggingface.co";
const RANDOM_USER_API = "https://randomuser.me/api/";
const fetchDisabled = process.env.RANKING_LOAD_NO_PUBLIC_DATA === "1";
const RENDER_CONCURRENCY = 6;

// Three independent, no-auth-required public resume sources. Every fetch pulls from all
// three and mixes the results. `opensporks/resumes` also ships the resume's original HTML
// markup (real section layout, headings, etc.) — that's what gets rendered when present;
// the other two only have plain text, so those render as a plain (but still fully real,
// un-truncated) resume body instead of our own template.
const RESUME_SOURCES = [
  {
    dataset: "opensporks/resumes", // mirror of the public Kaggle "Resume Dataset" — 2.4k+ resumes, ~24 job categories
    pick: (row) => ({ text: row.Resume_str, category: row.Category, html: row.Resume_html }),
  },
  {
    dataset: "brackozi/Resume", // ~960 resumes labeled by job category
    pick: (row) => ({ text: row.Resume, category: row.Category }),
  },
  {
    dataset: "InferencePrince555/Resume-Dataset", // 32k+ resumes generated per job title
    pick: (row) => ({ text: row.Resume_test, category: deriveCategoryFromInstruction(row.instruction) }),
  },
];

function deriveCategoryFromInstruction(instruction) {
  const match = /for an? (.+?) Job/i.exec(String(instruction ?? ""));
  return match ? match[1] : "";
}

export function sanitizeForPDF(text) {
  return text
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function fetchDatasetRowCount(dataset) {
  const response = await fetch(`${HF_DATASETS_SERVER}/size?dataset=${encodeURIComponent(dataset)}`);
  if (!response.ok) {
    throw new Error(`dataset size lookup failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const rowCount = payload.size?.dataset?.num_rows;
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new Error("dataset size response did not include num_rows");
  }
  return rowCount;
}

async function fetchRowsFromSource(source, count) {
  const rowCount = await fetchDatasetRowCount(source.dataset);
  const take = Math.min(count, rowCount);
  const maxStart = Math.max(0, rowCount - take);
  const startOffset = Math.floor(Math.random() * (maxStart + 1));
  const rows = [];
  for (let cursor = 0; rows.length < take; cursor += 100) {
    const length = Math.min(100, take - rows.length);
    const url =
      `${HF_DATASETS_SERVER}/rows?dataset=${encodeURIComponent(source.dataset)}` +
      `&config=default&split=train&offset=${startOffset + cursor}&length=${length}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${source.dataset} request failed: HTTP ${response.status}`);
    }
    const payload = await response.json();
    for (const item of payload.rows ?? []) {
      rows.push(source.pick(item.row));
    }
    if (!payload.rows?.length) {
      break;
    }
  }
  return rows;
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Spreads `count` across all RESUME_SOURCES and mixes the results. A source that's
// unreachable is skipped (logged) rather than failing the whole fetch — only if every
// source fails does this throw, which is what tells buildPublicCandidateFiles to fall back.
async function fetchResumeRows(count) {
  const perSource = Math.ceil(count / RESUME_SOURCES.length);
  const settled = await Promise.allSettled(RESUME_SOURCES.map((source) => fetchRowsFromSource(source, perSource)));
  const rows = [];
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      rows.push(...result.value);
    } else {
      failures.push(`${RESUME_SOURCES[index].dataset} (${result.reason?.message ?? result.reason})`);
    }
  });
  if (rows.length === 0) {
    throw new Error(`all resume sources failed: ${failures.join("; ")}`);
  }
  if (failures.length > 0) {
    console.warn(`Some resume sources were unavailable and were skipped: ${failures.join("; ")}`);
  }
  return shuffleInPlace(rows).slice(0, count);
}

async function fetchRealNames(count) {
  const response = await fetch(`${RANDOM_USER_API}?results=${count}&nat=us,gb,au,ca,nz,ie&inc=name`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`randomuser.me request failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return (payload.results ?? []).map((entry) => `${entry.name.first} ${entry.name.last}`);
}

// Wraps the *real* resume content in a minimal page shell — just enough CSS to make the
// dataset's own markup readable — plus a small header banner carrying the candidate's real
// (randomuser.me) name, since the dataset anonymizes that field. No TalentRank-branded boxes,
// no fabricated bullet points: what renders here is the actual resume text/HTML we fetched.
function buildResumeHTML(fullName, entry) {
  const firstName = fullName.split(" ")[0].toLowerCase();
  const header = `
    <div class="cv-header">
      <h1>${escapeHTML(fullName)}</h1>
      <p>${escapeHTML(firstName)}@resumeseed.example.com &middot; Available in 30 days</p>
    </div>`;

  if (entry?.html) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #1f2937; font-size: 12px; }
      .cv-header { padding: 26px 34px; background: #0f172a; color: #fff; }
      .cv-header h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
      .cv-header p { margin: 6px 0 0; font-size: 12.5px; color: #cbd5e1; }
      #document { padding: 22px 34px; line-height: 1.55; }
      .sectiontitle { font-weight: 700; color: #1d4ed8; text-transform: uppercase; font-size: 11px; letter-spacing: .06em; }
      .heading { margin-top: 16px; }
      .name { display: none; }
    </style></head><body>${header}${entry.html}</body></html>`;
  }

  // No rich HTML for this source — render the full real resume text as-is (plain, readable),
  // not squeezed into our own template.
  const text = sanitizeForPDF(String(entry?.text ?? "")) || "No resume content was available from the source dataset.";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, 'Times New Roman', serif; margin: 0; color: #1f2937; font-size: 12.5px; }
    .cv-header { padding: 26px 34px; background: #0f172a; color: #fff; font-family: Arial, Helvetica, sans-serif; }
    .cv-header h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
    .cv-header p { margin: 6px 0 0; font-size: 12.5px; color: #cbd5e1; }
    .cv-body { padding: 24px 34px; line-height: 1.7; white-space: pre-wrap; }
  </style></head><body>${header}<div class="cv-body">${escapeHTML(text)}</div></body></html>`;
}

async function renderCandidatePDF(browser, fullName, entry) {
  const page = await browser.newPage();
  try {
    await page.setContent(buildResumeHTML(fullName, entry), { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await page.close();
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Fetches `count` real names + `count` real resumes (mixed across all RESUME_SOURCES) and
// renders each pair into an actual PDF file via a headless browser — the real resume layout
// (or, for sources without HTML, the real full resume text) with the candidate's real name
// on top. Returns null (never throws) if public sources are disabled or all unreachable, so
// callers can fall back to the local synthetic template further below.
export async function buildPublicCandidateFiles(count) {
  if (fetchDisabled) {
    return null;
  }
  let browser;
  try {
    const [names, resumes] = await Promise.all([fetchRealNames(count), fetchResumeRows(count)]);
    browser = await chromium.launch({ headless: true });
    const activeBrowser = browser;
    return await mapWithConcurrency(names, RENDER_CONCURRENCY, async (baseName, index) => {
      const fullName = `${baseName} ${String(index + 1).padStart(3, "0")}`;
      const buffer = await renderCandidatePDF(activeBrowser, fullName, resumes[index]);
      return {
        name: fullName,
        filename: `${String(index + 1).padStart(3, "0")}-${fullName.toLowerCase().replaceAll(" ", "-")}.pdf`,
        buffer,
      };
    });
  } catch (error) {
    console.warn(`Skipping public dataset fetch (${error.message}); using local synthetic profiles instead.`);
    return null;
  } finally {
    await browser?.close();
  }
}

// Samples `count` candidate files out of a shared pool, shuffled once and then cycled
// through if `count` exceeds the pool size. This is what lets the same real candidate show
// up under more than one JD — mirroring a person applying to several job postings — instead
// of every job getting a fully disjoint set of CVs.
export function sampleCandidateFiles(pool, count) {
  if (!pool || pool.length === 0) {
    return [];
  }
  const order = shuffleInPlace([...pool.keys()]);
  return Array.from({ length: count }, (_, index) => pool[order[index % order.length]]);
}

const firstNames = [
  "An", "Binh", "Chi", "Duc", "Giang", "Hieu", "Khanh", "Lan",
  "Minh", "Nam", "Oanh", "Phuc", "Quang", "Trang", "Vy", "Yen",
];

const lastNames = ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vo", "Dang", "Bui", "Do", "Phan"];

// Local, network-free fallback profile generator (used only when the public sources above
// are completely unreachable). Not tailored to any specific JD — just a spread of
// backend/adjacent tech profiles so ranking still has signal to work with.
export function profileFor(index, total) {
  const name = `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]} ${String(index + 1).padStart(3, "0")}`;

  if (index < Math.min(6, total)) {
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

  if (index < Math.round(total * 0.16)) {
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

  if (index < Math.round(total * 0.45)) {
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

  if (index < Math.round(total * 0.65)) {
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

  if (index < Math.round(total * 0.84)) {
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

// Fallback-only template renderer (used solely when every public source above is
// unreachable). Produces our own hand-rolled PDF from a synthetic profile.
export function makePDF(lines) {
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
    pdfText(52, 198, "Generated resume with varied skill coverage for ranking demos.", "F1", 10, [0.208, 0.254, 0.333]),
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

function makeCandidatePDF(profile, filenameIndex) {
  const lines = [
    profile.name,
    profile.title,
    `${profile.years} years experience in production software teams.`,
    ...(profile.skills.length ? [`Skills: ${profile.skills.join(", ")}.`] : []),
    ...profile.impacts,
  ];
  return {
    filename: `${String(filenameIndex + 1).padStart(3, "0")}-${profile.name.toLowerCase().replaceAll(" ", "-")}.pdf`,
    buffer: makePDF(lines),
  };
}

// Resolves a full array of `count` candidate files: real ones from `pool` when available
// (sampled/reused as needed), otherwise the local synthetic template for every slot.
export function resolveCandidateFiles(pool, count, total = count) {
  if (pool && pool.length > 0) {
    return sampleCandidateFiles(pool, count);
  }
  return Array.from({ length: count }, (_, index) => {
    const profile = profileFor(index, total);
    const file = makeCandidatePDF(profile, index);
    return { name: profile.name, filename: file.filename, buffer: file.buffer };
  });
}

export async function postForm(baseURL, form) {
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

export async function createJob(baseURL, title, description) {
  const form = new FormData();
  form.append("action", "create_job");
  form.append("title", title);
  form.append("jd", description);
  return postForm(baseURL, form);
}

export async function uploadBatch(baseURL, jobID, start, end, files) {
  const form = new FormData();
  form.append("action", "upload_cvs");
  form.append("job_id", jobID);
  for (let index = start; index < end; index += 1) {
    const file = files[index];
    form.append("files", new Blob([file.buffer], { type: "application/pdf" }), file.filename);
  }
  return postForm(baseURL, form);
}

export async function runRanking(baseURL, jobID) {
  const form = new FormData();
  form.append("action", "run_ranking");
  form.append("job_id", jobID);
  return postForm(baseURL, form);
}
