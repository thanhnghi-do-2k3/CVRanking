#!/usr/bin/env node

import { buildPublicCandidatePool, createJob, resolveProfiles, runRanking, uploadBatch } from "./lib/candidate-generator.mjs";

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

async function main() {
  if (!Number.isInteger(totalCVs) || totalCVs < 1 || totalCVs > 200) {
    throw new Error("RANKING_LOAD_COUNT must be between 1 and 200.");
  }

  const startedAt = Date.now();
  const pool = await buildPublicCandidatePool(totalCVs);
  console.log(
    pool
      ? `Sourced ${pool.length} candidates from public datasets (opensporks/resumes, brackozi/Resume, InferencePrince555/Resume-Dataset + randomuser.me).`
      : "Using local synthetic candidate profiles (public dataset fetch skipped or unavailable).",
  );
  const profiles = resolveProfiles(pool, totalCVs);

  const created = await createJob(baseURL, jd.title, jd.description);
  console.log(`Created JD: ${created.job.title}`);
  console.log(`URL: ${baseURL}/jobs/${created.job.id}`);

  let accepted = 0;
  for (let start = 0; start < totalCVs; start += batchSize) {
    const end = Math.min(start + batchSize, totalCVs);
    const uploaded = await uploadBatch(baseURL, created.job.id, start, end, profiles);
    accepted += uploaded.upload.accepted;
    console.log(`Uploaded ${end}/${totalCVs} CV · accepted so far: ${accepted}`);
  }

  const rankingStarted = Date.now();
  const ranked = await runRanking(baseURL, created.job.id);
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
