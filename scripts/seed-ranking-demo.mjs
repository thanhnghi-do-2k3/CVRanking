#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const publicRoot = join(repoRoot, "frontend", "public");
const baseURL = process.env.RANKING_DEMO_URL ?? process.argv[2] ?? "http://localhost:3000";
const shouldReset = process.env.RANKING_DEMO_RESET !== "0";

async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf-8"));
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

function publicPathToFilePath(publicPath) {
  return join(publicRoot, publicPath.replace(/^\//, ""));
}

async function resetStore() {
  const form = new FormData();
  form.append("action", "reset_store");
  await postForm(form);
}

async function createJob(jobConfig) {
  const form = new FormData();
  form.append("action", "create_job");
  form.append("title", jobConfig.title);
  form.append("jd", jobConfig.description);
  return postForm(form);
}

async function uploadCVs(jobID, fixtureSet) {
  const form = new FormData();
  form.append("action", "upload_cvs");
  form.append("job_id", jobID);
  for (const cv of fixtureSet.cvs) {
    const buffer = await readFile(publicPathToFilePath(cv.path));
    const blob = new Blob([buffer], { type: "application/pdf" });
    form.append("files", blob, cv.name);
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
  const manifest = await readJSON(join(publicRoot, "ranking-fixtures", "manifest.json"));

  if (shouldReset) {
    await resetStore();
    console.log("Reset demo store");
  }

  const seeded = [];
  for (const fixtureSet of manifest.sets) {
    const jobConfig = await readJSON(publicPathToFilePath(fixtureSet.job_config_path));
    const created = await createJob(jobConfig);
    const uploaded = await uploadCVs(created.job.id, fixtureSet);
    const ranked = await runRanking(created.job.id);
    seeded.push({
      title: ranked.job.title,
      url: `/jobs/${ranked.job.id}`,
      cv_count: uploaded.upload.accepted,
      top: ranked.run.results?.[0]?.candidate?.full_name ?? "N/A",
      score: ranked.run.results?.[0]?.final_score ?? 0,
    });
    console.log(`Seeded ${ranked.job.title}: ${uploaded.upload.accepted} CV, top ${seeded.at(-1).top}`);
  }

  console.log(JSON.stringify({ baseURL, jobs: seeded }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
