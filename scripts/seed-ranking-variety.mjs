#!/usr/bin/env node

// Seeds several different JDs (not just one Backend Engineer job), each written in its own
// voice/structure and each getting a different-sized batch of candidates — some roles read
// as niche/senior (few applicants), others as high-volume/entry-level (a flood of them) —
// instead of every job looking like the same template stamped out N times.
//
// Candidates are sourced live from public datasets (real names + real resumes — see
// scripts/lib/candidate-generator.mjs), drawn from one shared pool so the same person can
// turn up applying to more than one JD.

import {
  buildPublicCandidateFiles,
  createJob,
  resolveCandidateFiles,
  runRanking,
  sampleCandidateFiles,
  uploadBatch,
} from "./lib/candidate-generator.mjs";

const baseURL = process.env.RANKING_DEMO_URL ?? process.argv[2] ?? "http://localhost:3000";
const batchSize = 50;
// Fraction of the total upload slots covered by *unique* candidates — the rest is filled by
// candidates reused from the shared pool across more than one JD, i.e. "one CV, several jobs".
const uniqueCandidateRatio = 0.7;

// If set, every JD gets exactly this many CVs (handy for a quick smoke test). Left unset by
// default so each JD's own `popularity` range decides its count instead.
const explicitCountArg = process.env.RANKING_SEED_CVS_PER_JOB ?? process.argv[3];
const fixedCVsPerJob = explicitCountArg !== undefined ? Number.parseInt(explicitCountArg, 10) : null;

// Rough "how many people apply to this kind of role" bands.
const POPULARITY_RANGES = {
  high: [45, 85], // common / entry-level roles that get flooded with applicants
  medium: [20, 45],
  low: [8, 22], // niche or senior roles with a shallower qualified pool
};

const JD_TEMPLATES = [
  {
    title: "Senior Backend Engineer",
    popularity: "medium",
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
      "- Bachelor's degree in Computer Science or a related field.",
      "",
      "Nice to have",
      "- Kubernetes, AWS and experience operating multi-service platforms.",
    ].join("\n"),
  },
  {
    title: "Data Scientist",
    popularity: "medium",
    description: [
      "Why this role exists",
      "Our matching quality lives or dies on the models behind it. We need someone who can take that seriously.",
      "",
      "A day in the life",
      "You'll spend most days moving between notebooks and production: exploring candidate-job match data, ",
      "training and evaluating models, then working with engineering to get the ones that matter into the live pipeline.",
      "",
      "You're a fit if",
      "* You have 3+ years working with Python, Pandas and SQL on real datasets, not just coursework.",
      "* You hold a Bachelor's degree in Computer Science, Statistics or a related field.",
      "* You can explain a model's tradeoffs to a non-technical teammate without losing the point.",
      "",
      "Bonus points",
      "* AWS, TensorFlow or PyTorch in production.",
      "* Any data science or cloud certification.",
    ].join("\n"),
  },
  {
    title: "HR Business Partner",
    popularity: "low",
    description: [
      "We're looking for someone to be the trusted HR voice inside a fast-growing team.",
      "",
      "This isn't a policy-enforcement seat. You'll sit with managers on hiring plans, coach through tricky ",
      "employee-relations moments, and keep onboarding and HR compliance running quietly in the background so ",
      "the rest of the company barely notices it's there.",
      "",
      "What we're looking for: a Bachelor's degree in Human Resources, Business or a related field, 5+ years in an ",
      "HR generalist or business partner role, and strong English communication — you'll be writing and presenting ",
      "to leadership regularly.",
      "",
      "A SHRM certification or hands-on experience with an HRIS platform like Workday or BambooHR is a genuine plus, ",
      "but not a dealbreaker if everything else lines up.",
    ].join("\n"),
  },
  {
    title: "Sales Account Executive",
    popularity: "high",
    description: [
      "Enterprise Sales Account Executive — quota-carrying, full-cycle, no hand-holding.",
      "",
      "You own the pipeline from first cold outreach to signed contract. That means prospecting, running the demo, ",
      "handling procurement back-and-forth, and closing — all logged in Salesforce, all against a real quarterly number.",
      "",
      "Must-haves: 3+ years of B2B sales or account management, sharp English negotiation skills, and real CRM ",
      "discipline (Salesforce or equivalent).",
      "",
      "Good to have: a Business degree, or prior experience selling SaaS/enterprise software specifically.",
    ].join("\n"),
  },
  {
    title: "Frontend Engineer",
    popularity: "high",
    description: [
      "About the role",
      "Small frontend team, big surface area: you'll be one of the people shaping how recruiters actually experience this product.",
      "",
      "Stack: React + TypeScript, REST APIs on the backend, a design system you'll help keep honest.",
      "",
      "What you'll do",
      "- Build and maintain React/TypeScript interfaces for recruiter workflows.",
      "- Integrate REST APIs and work closely with backend engineers on contracts.",
      "- Push on performance, accessibility and visual consistency — not just shipping features.",
      "",
      "What you bring",
      "- 3+ years with React, TypeScript and modern CSS.",
      "- Comfort debugging real UI performance issues, not just following a style guide.",
      "- A CS degree or equivalent hands-on experience.",
      "",
      "Nice to have: Next.js, and experience building or maintaining a component library.",
    ].join("\n"),
  },
  {
    title: "Financial Analyst",
    popularity: "medium",
    description: [
      "About the role",
      "We are hiring a Financial Analyst to support budgeting, forecasting and reporting for the finance organization.",
      "",
      "Key responsibilities",
      "1. Build financial models and variance analysis for leadership reviews.",
      "2. Prepare monthly and quarterly reporting using Excel and internal tooling.",
      "3. Partner with accounting on month-end close processes and audits.",
      "",
      "Requirements",
      "1. Bachelor's degree in Finance, Accounting or a related field.",
      "2. 4+ years of experience in financial analysis or accounting.",
      "3. Advanced Excel and financial modeling skills.",
      "",
      "Preferred qualifications",
      "1. CPA or CFA certification.",
      "2. Experience with ERP systems such as NetSuite or SAP.",
    ].join("\n"),
  },
  {
    title: "Site Reliability Engineer",
    popularity: "low",
    description: [
      "SRE. On-call rotation. Production ownership. If that sentence didn't scare you off, keep reading.",
      "",
      "- Run Kubernetes clusters, CI/CD pipelines and the monitoring stack that watches them.",
      "- Automate infrastructure in Terraform instead of clicking through consoles.",
      "- Take on-call seriously: fast triage, real postmortems, fixes that actually stick.",
      "",
      "Non-negotiable: 4+ years with Linux, Kubernetes and Docker in a real production environment, plus Terraform, ",
      "CI/CD and cloud infra (AWS or GCP) chops.",
      "",
      "Nice to have: a CS degree or equivalent experience, and any AWS/GCP/Kubernetes certification.",
    ].join("\n"),
  },
  {
    title: "Customer Support Specialist",
    popularity: "high",
    description: [
      "About the role",
      "Our recruiters depend on this product daily — you're the person who makes sure a bad day with it doesn't ruin theirs.",
      "",
      "Key responsibilities",
      "- Answer tickets and live chat with patience and actual empathy, not a script.",
      "- Troubleshoot account, billing and product usage issues end to end.",
      "- Turn recurring questions into help-center articles so the next person doesn't have to ask.",
      "",
      "Requirements",
      "- 2+ years in customer support or a BPO environment.",
      "- Strong written and spoken English.",
      "- Comfortable in helpdesk tools like Zendesk or Intercom.",
      "",
      "Nice to have: prior support experience for a SaaS or B2B product. Degree in any field is fine — we care about the work.",
    ].join("\n"),
  },
];

function countForTemplate(template) {
  if (fixedCVsPerJob !== null) {
    return fixedCVsPerJob;
  }
  const [min, max] = POPULARITY_RANGES[template.popularity];
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function seedJob(template, files, appearances) {
  const created = await createJob(baseURL, template.title, template.description);
  for (const file of files) {
    appearances.set(file.name, (appearances.get(file.name) ?? 0) + 1);
  }

  let accepted = 0;
  for (let start = 0; start < files.length; start += batchSize) {
    const end = Math.min(start + batchSize, files.length);
    const uploaded = await uploadBatch(baseURL, created.job.id, start, end, files);
    accepted += uploaded.upload.accepted;
  }

  const ranked = await runRanking(baseURL, created.job.id);
  const top3 = ranked.run.results?.slice(0, 3).map((result) => ({
    name: result.candidate.full_name,
    score: Math.round(result.final_score * 100),
  }));

  return {
    title: template.title,
    job_url: `${baseURL}/jobs/${created.job.id}`,
    cv_count: ranked.job.cv_count,
    top_3: top3,
  };
}

async function main() {
  const jobCounts = JD_TEMPLATES.map((template) => countForTemplate(template));
  if (jobCounts.some((count) => !Number.isInteger(count) || count < 1 || count > 100)) {
    throw new Error("RANKING_SEED_CVS_PER_JOB must be between 1 and 100.");
  }
  const totalSlots = jobCounts.reduce((sum, count) => sum + count, 0);
  const sharedPoolSize = Math.max(...jobCounts, Math.ceil(totalSlots * uniqueCandidateRatio));

  console.log(
    fixedCVsPerJob !== null
      ? `Seeding ${JD_TEMPLATES.length} JDs with a fixed ${fixedCVsPerJob} CV each (${totalSlots} total slots)...`
      : `Seeding ${JD_TEMPLATES.length} JDs with varied applicant volume per role: ` +
          JD_TEMPLATES.map((template, index) => `${template.title} (${jobCounts[index]})`).join(", ") +
          ` — ${totalSlots} total slots.`,
  );
  console.log(
    `Rendering a shared pool of ${sharedPoolSize} real CVs from public datasets (some will apply to more than one JD)...`,
  );
  const sharedPool = await buildPublicCandidateFiles(sharedPoolSize);
  console.log(
    sharedPool
      ? `Sourced ${sharedPool.length} real CVs from public datasets (opensporks/resumes, brackozi/Resume, InferencePrince555/Resume-Dataset + randomuser.me).`
      : "Public dataset fetch unavailable; using local synthetic profiles for every JD.",
  );

  const appearances = new Map();
  const summaries = [];
  for (const [index, template] of JD_TEMPLATES.entries()) {
    const count = jobCounts[index];
    console.log(`\n— ${template.title} (${template.popularity} volume, ${count} CV) —`);
    const files = sharedPool ? sampleCandidateFiles(sharedPool, count) : resolveCandidateFiles(null, count);
    const summary = await seedJob(template, files, appearances);
    console.log(`  ${summary.job_url}  (${summary.cv_count} CV)`);
    summaries.push(summary);
  }

  const reused = [...appearances.entries()].filter(([, count]) => count > 1);
  console.log(
    `\n${reused.length} candidate${reused.length === 1 ? "" : "s"} out of ${appearances.size} unique candidates applied to more than one JD.`,
  );
  if (reused.length > 0) {
    console.log(
      reused
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => `  - ${name}: ${count} JDs`)
        .join("\n"),
    );
  }

  console.log("\nDone. Summary:");
  console.log(JSON.stringify(summaries, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
