import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const aiBaseURL = process.env.AI_INTERNAL_URL ?? process.env.AI_BASE_URL ?? "http://localhost:8000";

const DATA_DIR = process.env.RANKING_DEMO_DATA_DIR || path.join(process.cwd(), ".data");
const PDF_DIR = path.join(DATA_DIR, "pdfs");
const STORE_FILE = path.join(DATA_DIR, "store.json");

type Evidence = {
  id: string;
  text: string;
  page?: number | null;
  start_offset?: number | null;
  end_offset?: number | null;
};

type ExtractedField<T> = {
  value: T;
  confidence: number;
  evidences: Evidence[];
};

type ExtractedSkill = {
  name: string;
  normalized_name?: string | null;
  match_kind: string;
  estimated_years?: number | null;
  confidence: number;
  evidences: Evidence[];
};

type ResumeAnalysis = {
  document: { parser_version: string };
  candidate: {
    full_name?: ExtractedField<string> | null;
    current_title?: ExtractedField<string> | null;
    total_years_experience?: ExtractedField<number> | null;
    skills: ExtractedSkill[];
  };
};

type JobRequirement = {
  requirement_key: string;
  name: string;
  requirement_type: string;
  priority: string;
  weight: number;
  minimum_years?: number | null;
  is_hard_constraint: boolean;
  description: string;
  source_evidence: Evidence[];
};

type JobParseResult = {
  requirements: JobRequirement[];
  parser_version: string;
};

type RankingCandidate = {
  candidate_id: string;
  current_title: string;
  total_years_experience?: number | null;
  skills: Array<{
    name: string;
    estimated_years?: number | null;
    evidences: Evidence[];
  }>;
};

type RankingResponse = {
  results: Array<{
    candidate_id: string;
    rank: number;
    final_score: number;
    confidence: number;
    eligibility_status: string;
    strengths: string[];
    gaps: string[];
    unknowns: string[];
    requirement_assessments: Array<{
      requirement_id: string;
      status: string;
      score: number;
      confidence: number;
      evidences: Evidence[];
    }>;
  }>;
  model_version: string;
  feature_schema_version: string;
};

type GeminiRankingPayload = {
  results?: Array<{
    candidate_id?: string;
    score?: number;
    confidence?: number;
    eligibility_status?: string;
    strengths?: string[];
    gaps?: string[];
    unknowns?: string[];
    requirement_scores?: Array<{
      requirement_key?: string;
      status?: string;
      score?: number;
      confidence?: number;
    }>;
  }>;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type UploadItem = {
  filename: string;
  status: "ready" | "duplicate" | "failed";
  full_name?: string;
  current_title?: string;
  skills?: string[];
  error?: string;
};

type StoredCV = UploadItem & {
  id: string;
  resume_id: string;
  candidate_id?: string;
  preview_text?: string;
  document_mime?: string;
  document_data_url?: string;
  has_document_preview?: boolean;
  total_years_experience?: number | null;
  uploaded_at: string;
  ranking_candidate?: RankingCandidate;
  candidate_summary?: Record<string, unknown>;
};

type StoredRun = {
  id: string;
  job_id: string;
  job_version_id: string;
  status: "completed";
  progress: number;
  model_version: string;
  feature_schema_version: string;
  candidate_count: number;
  created_at: string;
  started_at: string;
  finished_at: string;
  results: Array<{
    id: string;
    ranking_run_id: string;
    candidate: Record<string, unknown>;
    rank: number;
    final_score: number;
    confidence: number;
    eligibility_status: string;
    strengths: string[];
    gaps: string[];
    unknowns: string[];
    requirement_scores: Array<{
      requirement_key: string;
      status: string;
      score: number;
      confidence: number;
      evidence_ids: string[];
    }>;
  }>;
};

type StoredJob = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  parser_version: string;
  requirements: JobRequirement[];
  cv_count: number;
  cvs: StoredCV[];
  latest_run: StoredRun | null;
};

type DemoStore = {
  version: number;
  jobs: StoredJob[];
};

class DemoProblem extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

declare global {
  var rankingDemoStore: DemoStore | undefined;
}

function problem(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

function ensureDataDir() {
  try {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  } catch (error) {
    console.warn("ranking_demo_data_dir_failed", error);
  }
}

function pdfFilePath(cvID: string) {
  return path.join(PDF_DIR, `${cvID}.pdf`);
}

// Keeps the large base64 PDF payloads out of the JSON file — those live on disk
// per-CV instead, so persisting the store on every mutation stays fast even for
// a 150-CV load-test job.
function stripDocumentData(store: DemoStore): DemoStore {
  return {
    ...store,
    jobs: store.jobs.map((job) => ({
      ...job,
      cvs: job.cvs.map(({ document_data_url, ...cv }) => ({
        ...cv,
        has_document_preview: cv.has_document_preview || Boolean(document_data_url),
      })),
    })),
  } as DemoStore;
}

function persistDemoStore(store: DemoStore) {
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(stripDocumentData(store)));
  } catch (error) {
    console.warn("ranking_demo_store_persist_failed", error);
  }
}

function loadDemoStoreFromDisk(): DemoStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as DemoStore;
    if (parsed && Array.isArray(parsed.jobs)) {
      return { version: 2, jobs: parsed.jobs };
    }
  } catch {
    // No persisted store yet (first run) or the file is unreadable — start fresh.
  }
  return { version: 2, jobs: [] };
}

function readDemoStore(): DemoStore {
  globalThis.rankingDemoStore ??= loadDemoStoreFromDisk();
  return globalThis.rankingDemoStore;
}

function resetDemoStore() {
  const store: DemoStore = { version: 2, jobs: [] };
  globalThis.rankingDemoStore = store;
  persistDemoStore(store);
  try {
    fs.rmSync(PDF_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn("ranking_demo_pdf_cleanup_failed", error);
  }
  return store;
}

function saveJob(job: StoredJob) {
  const store = readDemoStore();
  const updated: DemoStore = {
    version: 2,
    jobs: [job, ...store.jobs.filter((item) => item.id !== job.id)].slice(0, 30),
  };
  globalThis.rankingDemoStore = updated;
  persistDemoStore(updated);
}

function getJob(jobID: string) {
  return readDemoStore().jobs.find((job) => job.id === jobID) ?? null;
}

async function postJSON<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${aiBaseURL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`AI service returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function analyzeFile(file: File): Promise<ResumeAnalysis> {
  const body = new FormData();
  body.append("file", file, file.name);
  const response = await fetch(`${aiBaseURL}/internal/v1/documents/analyze`, {
    method: "POST",
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`AI analyze failed for ${file.name}: ${await response.text()}`);
  }
  return response.json() as Promise<ResumeAnalysis>;
}

function fieldValue<T>(field: ExtractedField<T> | null | undefined, fallback: T) {
  return field?.value ?? fallback;
}

function cleanPreviewText(value: string) {
  return value
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/[^\x20-\x7E\n\r\tÀ-ỹ]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function buildPreviewText(file: File) {
  try {
    const raw = await file.text();
    const pdfText = Array.from(raw.matchAll(/\(([^()]{2,})\)\s*Tj/g))
      .map((match) => cleanPreviewText(match[1] ?? ""))
      .filter(Boolean)
      .join("\n");

    if (pdfText.length > 40) {
      return pdfText.slice(0, 5000);
    }

    const printable = cleanPreviewText(raw);
    if (printable.length > 40 && !printable.startsWith("%PDF")) {
      return printable.slice(0, 5000);
    }
  } catch {
    return "";
  }

  return "Preview text chưa khả dụng cho file này. Hãy dùng PDF/DOCX có text layer để xem nội dung trực tiếp.";
}

async function buildDocumentPreview(file: File, cvID: string) {
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  if (mime !== "application/pdf") {
    return null;
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    ensureDataDir();
    fs.writeFileSync(pdfFilePath(cvID), buffer);
  } catch (error) {
    console.warn("ranking_demo_pdf_persist_failed", error);
  }
  return {
    document_mime: "application/pdf",
    document_data_url: `data:application/pdf;base64,${buffer.toString("base64")}`,
  };
}

async function createJob(title: string, description: string) {
  if (description.length < 20) {
    throw new DemoProblem(422, "JD cần ít nhất 20 ký tự.");
  }
  const parsed = await postJSON<JobParseResult>("/internal/v1/jobs/parse", {
    title: title || "Ranking demo job",
    description,
  });
  const now = new Date().toISOString();
  const job: StoredJob = {
    id: `jd-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    title: title || "Ranking demo job",
    description,
    created_at: now,
    updated_at: now,
    parser_version: parsed.parser_version,
    requirements: parsed.requirements,
    cv_count: 0,
    cvs: [],
    latest_run: null,
  };
  saveJob(job);
  return job;
}

async function analyzeFilesForJob(files: File[], job: StoredJob) {
  const uploadItems: UploadItem[] = [];
  const storedCVs: StoredCV[] = [];

  for (const [index, file] of files.entries()) {
    const cvIndex = job.cvs.length + index + 1;
    const cvID = `cv-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const candidateID = `candidate-${cvIndex}`;
    const previewText = await buildPreviewText(file);
    const documentPreview = await buildDocumentPreview(file, cvID);
    try {
      const analysis = await analyzeFile(file);
      const fullName = fieldValue(
        analysis.candidate.full_name,
        file.name.replace(/\.(pdf|docx)$/i, ""),
      );
      const currentTitle = fieldValue(analysis.candidate.current_title, "");
      const totalYears = analysis.candidate.total_years_experience?.value ?? null;
      const skills = analysis.candidate.skills.map((skill) => ({
        name: skill.normalized_name || skill.name,
        estimated_years: skill.estimated_years ?? null,
        evidences: skill.evidences,
      }));
      const uploadItem: UploadItem = {
        filename: file.name,
        status: "ready",
        full_name: fullName,
        current_title: currentTitle,
        skills: skills.map((skill) => skill.name),
      };
      uploadItems.push(uploadItem);
      storedCVs.push({
        ...uploadItem,
        id: cvID,
        resume_id: `resume-${cvIndex}`,
        candidate_id: candidateID,
        preview_text: previewText,
        ...documentPreview,
        total_years_experience: totalYears,
        uploaded_at: new Date().toISOString(),
        ranking_candidate: {
          candidate_id: candidateID,
          current_title: currentTitle,
          total_years_experience: totalYears,
          skills,
        },
        candidate_summary: {
          id: candidateID,
          resume_id: `resume-${cvIndex}`,
          full_name: fullName,
          current_title: currentTitle,
          total_years_experience: totalYears,
          status: "new",
          filename: file.name,
        },
      });
    } catch (error) {
      const failedItem: UploadItem = {
        filename: file.name,
        status: "failed",
        error: error instanceof Error ? error.message : "Không parse được CV.",
      };
      uploadItems.push(failedItem);
      storedCVs.push({
        ...failedItem,
        id: cvID,
        resume_id: `resume-${cvIndex}`,
        preview_text: previewText,
        ...documentPreview,
        uploaded_at: new Date().toISOString(),
      });
    }
  }

  return {
    upload: {
      items: uploadItems,
      accepted: uploadItems.filter((item) => item.status !== "failed").length,
      failed: uploadItems.filter((item) => item.status === "failed").length,
    },
    storedCVs,
  };
}

function buildRun(job: StoredJob, scored: RankingResponse): StoredRun {
  const runID = crypto.randomUUID();
  const now = new Date().toISOString();
  const summaries = new Map(
    job.cvs
      .filter((cv) => cv.candidate_id && cv.candidate_summary)
      .map((cv) => [cv.candidate_id, cv.candidate_summary as Record<string, unknown>]),
  );

  return {
    id: runID,
    job_id: job.id,
    job_version_id: `${job.id}-v1`,
    status: "completed",
    progress: 100,
    model_version: scored.model_version,
    feature_schema_version: scored.feature_schema_version,
    candidate_count: scored.results.length,
    created_at: now,
    started_at: now,
    finished_at: now,
    results: scored.results.map((result) => ({
      id: crypto.randomUUID(),
      ranking_run_id: runID,
      candidate: summaries.get(result.candidate_id) ?? {
        id: result.candidate_id,
        full_name: result.candidate_id,
      },
      rank: result.rank,
      final_score: result.final_score,
      confidence: result.confidence,
      eligibility_status: result.eligibility_status,
      strengths: result.strengths,
      gaps: result.gaps,
      unknowns: result.unknowns,
      requirement_scores: result.requirement_assessments.map((assessment) => ({
        requirement_key: assessment.requirement_id,
        status: assessment.status,
        score: assessment.score,
        confidence: assessment.confidence,
        evidence_ids: assessment.evidences.map((evidence) => evidence.id),
      })),
    })),
  };
}

function geminiKeys() {
  const numberedKeys = Object.entries(process.env)
    .filter(([name]) => /^GEMINI_API_KEY_\d+$/.test(name))
    .sort(([left], [right]) => Number(left.replace("GEMINI_API_KEY_", "")) - Number(right.replace("GEMINI_API_KEY_", "")))
    .map(([, value]) => value ?? "");

  const keys = [process.env.GEMINI_API_KEY ?? "", ...numberedKeys, process.env.GEMINI_API_KEYS ?? ""]
    .join(",")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  return Array.from(new Set(keys));
}

function geminiModelName() {
  return (process.env.GEMINI_MODEL || "gemini-2.0-flash").replace(/^models\//, "");
}

function groqKey() {
  return (process.env.GROQ_API_KEY || "").trim();
}

function groqModelName() {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

function aiCandidateLimit() {
  const parsed = Number(process.env.AI_RANKING_CANDIDATE_LIMIT || 25);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(200, Math.floor(parsed)) : 25;
}

function aiRerankStatus() {
  const hasGemini = geminiKeys().length > 0;
  const hasGroq = Boolean(groqKey());
  return {
    available: hasGemini || hasGroq,
    provider: hasGemini ? ("gemini" as const) : hasGroq ? ("groq" as const) : null,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelayMs(message: string, fallbackMs = 1800) {
  const match = message.match(/try again in\s+([\d.]+)s/i);
  if (!match) {
    return fallbackMs;
  }
  return Math.ceil(Number(match[1]) * 1000) + 400;
}

function rankingSystemPrompt() {
  return [
    "You are an expert AI recruiter ranking CVs against a job description.",
    "Use semantic judgment, evidence from parsed CV fields, and the stated JD requirements.",
    "Must-have requirements should dominate score. Nice-to-have requirements should only differentiate similar candidates.",
    "Do not reward candidates for skills not evidenced in the parsed CV.",
    "Return strict JSON only. Do not include markdown.",
    "Schema: {\"results\":[{\"candidate_id\":\"...\",\"score\":0-1,\"confidence\":0-1,\"eligibility_status\":\"eligible|potentially_eligible|constraint_unknown|constraint_failed\",\"strengths\":[\"...\"],\"gaps\":[\"...\"],\"unknowns\":[\"...\"],\"requirement_scores\":[{\"requirement_key\":\"R1\",\"status\":\"met|partially_met|not_found|not_met|unknown\",\"score\":0-1,\"confidence\":0-1}]}]}",
  ].join("\n");
}

function clampScore(value: unknown, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeEligibility(value: unknown, fallback: string) {
  const text = String(value ?? fallback);
  return ["eligible", "potentially_eligible", "constraint_unknown", "constraint_failed"].includes(text)
    ? text
    : fallback;
}

function normalizeRequirementStatus(value: unknown, fallback: string) {
  const text = String(value ?? fallback);
  return ["met", "partially_met", "not_found", "not_met", "unknown"].includes(text) ? text : fallback;
}

function extractGeminiJSON(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as GeminiRankingPayload;
}

function compactCandidate(cv: StoredCV, candidate: RankingCandidate, baselineResult: RankingResponse["results"][number] | undefined) {
  return {
    candidate_id: candidate.candidate_id,
    name: cv.full_name || cv.filename,
    title: candidate.current_title || cv.current_title || "",
    years: candidate.total_years_experience,
    skills: candidate.skills.slice(0, 12).map((skill) => ({
      name: skill.name,
      years: skill.estimated_years,
      evidence: skill.evidences[0]?.text?.slice(0, 90) ?? "",
    })),
    baseline_score: baselineResult?.final_score,
    parsed_summary: cv.preview_text?.split(/\r?\n/).slice(0, 8).join(" ").slice(0, 420),
  };
}

function selectCandidatesForAI(candidates: RankingCandidate[], baseline: RankingResponse) {
  const byID = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  return baseline.results
    .slice(0, aiCandidateLimit())
    .map((result) => byID.get(result.candidate_id))
    .filter((candidate): candidate is RankingCandidate => Boolean(candidate));
}

function buildAIRankingInput(job: StoredJob, candidates: RankingCandidate[], baseline: RankingResponse) {
  const baselineByCandidate = new Map(baseline.results.map((result) => [result.candidate_id, result]));
  const cvByCandidate = new Map(job.cvs.filter((cv) => cv.candidate_id).map((cv) => [cv.candidate_id, cv]));

  return {
    job: {
      title: job.title,
      description: job.description,
      requirements: job.requirements.map((requirement) => ({
        key: requirement.requirement_key,
        name: requirement.name,
        type: requirement.requirement_type,
        priority: requirement.priority,
        weight: requirement.weight,
        minimum_years: requirement.minimum_years,
        description: requirement.description,
      })),
    },
    candidates: candidates.map((candidate) => {
      const cv = cvByCandidate.get(candidate.candidate_id);
      return compactCandidate(
        cv ??
          ({
            filename: candidate.candidate_id,
            full_name: candidate.candidate_id,
            current_title: candidate.current_title,
          } as StoredCV),
        candidate,
        baselineByCandidate.get(candidate.candidate_id),
      );
    }),
  };
}

async function callGeminiRanking(job: StoredJob, candidates: RankingCandidate[], baseline: RankingResponse) {
  const keys = geminiKeys();
  const aiCandidates = selectCandidatesForAI(candidates, baseline);
  if (keys.length === 0 || aiCandidates.length === 0) {
    return null;
  }

  const model = geminiModelName();
  const systemPrompt = rankingSystemPrompt();
  const rankingInput = buildAIRankingInput(job, aiCandidates, baseline);

  let lastError = "";
  const startCursor = Number(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % keys.length);

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const key = keys[(startCursor + attempt) % keys.length];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: JSON.stringify(rankingInput),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: "application/json",
          },
        }),
      });

      const payload = (await response.json()) as GeminiGenerateResponse;
      if (!response.ok) {
        lastError = payload.error?.message || `Gemini HTTP ${response.status}`;
        continue;
      }

      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
      if (!text) {
        lastError = "Gemini returned an empty ranking response.";
        continue;
      }
      const parsed = extractGeminiJSON(text);
      if (!parsed.results?.length) {
        lastError = "Gemini ranking response did not include results.";
        continue;
      }
      return buildAIRankingResponse(parsed, baseline, `gemini-ai-rerank-v1:${model}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Gemini ranking request failed.";
    }
  }

  console.warn("gemini_ranking_fallback", lastError);
  return null;
}

async function callGroqRanking(job: StoredJob, candidates: RankingCandidate[], baseline: RankingResponse) {
  const key = groqKey();
  const aiCandidates = selectCandidatesForAI(candidates, baseline);
  if (!key || aiCandidates.length === 0) {
    return null;
  }

  const model = groqModelName();
  const rankingInput = buildAIRankingInput(job, aiCandidates, baseline);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: rankingSystemPrompt() },
            { role: "user", content: JSON.stringify(rankingInput) },
          ],
          temperature: 0.15,
          response_format: { type: "json_object" },
        }),
      });

      const payload = (await response.json()) as OpenAIChatResponse;
      if (!response.ok) {
        const message = payload.error?.message || `Groq HTTP ${response.status}`;
        if (response.status === 429 && attempt < 2) {
          await sleep(retryDelayMs(message));
          continue;
        }
        console.warn("groq_ranking_fallback", message);
        return null;
      }

      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        console.warn("groq_ranking_fallback", "Groq returned an empty ranking response.");
        return null;
      }

      const parsed = extractGeminiJSON(text);
      if (!parsed.results?.length) {
        console.warn("groq_ranking_fallback", "Groq ranking response did not include results.");
        return null;
      }

      return buildAIRankingResponse(parsed, baseline, `groq-ai-rerank-v1:${model}`);
    } catch (error) {
      if (attempt < 2) {
        await sleep(1200);
        continue;
      }
      console.warn("groq_ranking_fallback", error instanceof Error ? error.message : "Groq ranking request failed.");
      return null;
    }
  }

  return null;
}

function buildAIRankingResponse(gemini: GeminiRankingPayload, baseline: RankingResponse, modelVersion: string): RankingResponse {
  const baselineByCandidate = new Map(baseline.results.map((result) => [result.candidate_id, result]));
  const geminiByCandidate = new Map(
    (gemini.results ?? [])
      .filter((result) => result.candidate_id)
      .map((result) => [String(result.candidate_id), result]),
  );

  const merged = baseline.results.map((baselineResult) => {
    const aiResult = geminiByCandidate.get(baselineResult.candidate_id);
    const aiRequirementScores = new Map(
      (aiResult?.requirement_scores ?? [])
        .filter((score) => score.requirement_key)
        .map((score) => [String(score.requirement_key), score]),
    );

    return {
      ...baselineResult,
      rank: 1,
      final_score: Number(clampScore(aiResult?.score, baselineResult.final_score).toFixed(6)),
      confidence: Number(clampScore(aiResult?.confidence, baselineResult.confidence).toFixed(6)),
      eligibility_status: normalizeEligibility(aiResult?.eligibility_status, baselineResult.eligibility_status),
      strengths: aiResult?.strengths?.length ? aiResult.strengths.slice(0, 5) : baselineResult.strengths,
      gaps: aiResult?.gaps?.length ? aiResult.gaps.slice(0, 5) : baselineResult.gaps,
      unknowns: aiResult?.unknowns?.length ? aiResult.unknowns.slice(0, 4) : baselineResult.unknowns,
      requirement_assessments: baselineResult.requirement_assessments.map((assessment) => {
        const aiAssessment = aiRequirementScores.get(assessment.requirement_id);
        return {
          ...assessment,
          status: normalizeRequirementStatus(aiAssessment?.status, assessment.status),
          score: Number(clampScore(aiAssessment?.score, assessment.score).toFixed(4)),
          confidence: Number(clampScore(aiAssessment?.confidence, assessment.confidence).toFixed(4)),
        };
      }),
    };
  });

  merged.sort((left, right) => {
    const baselineLeft = baselineByCandidate.get(left.candidate_id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const baselineRight = baselineByCandidate.get(right.candidate_id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return right.final_score - left.final_score || right.confidence - left.confidence || baselineLeft - baselineRight;
  });
  merged.forEach((result, index) => {
    result.rank = index + 1;
  });

  return {
    results: merged,
    model_version: modelVersion,
    feature_schema_version: `${baseline.feature_schema_version}+ai-rerank`,
  };
}

async function rankJob(job: StoredJob) {
  const candidates = job.cvs
    .map((cv) => cv.ranking_candidate)
    .filter((candidate): candidate is RankingCandidate => Boolean(candidate));

  if (candidates.length === 0) {
    throw new DemoProblem(422, "JD này chưa có CV parse thành công để ranking.");
  }

  const baselineScored = await postJSON<RankingResponse>("/internal/v1/rankings/score", {
    requirements: job.requirements,
    candidates,
  });
  const scored =
    (await callGeminiRanking(job, candidates, baselineScored)) ??
    (await callGroqRanking(job, candidates, baselineScored)) ??
    baselineScored;
  const latestRun = buildRun(job, scored);
  const updatedJob: StoredJob = {
    ...job,
    updated_at: latestRun.finished_at,
    latest_run: latestRun,
  };
  saveJob(updatedJob);
  return updatedJob;
}

function responseError(error: unknown) {
  if (error instanceof DemoProblem) {
    return problem(error.status, error.message);
  }
  return problem(502, error instanceof Error ? error.message : "Không thể gọi AI service.");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cvID = url.searchParams.get("cv_id");
  if (url.searchParams.get("document") === "1" && cvID) {
    const cv = readDemoStore().jobs.flatMap((job) => job.cvs).find((item) => item.id === cvID);
    if (!cv) {
      return problem(404, "Không tìm thấy CV này.");
    }
    let dataURL = cv.document_data_url;
    if (!dataURL) {
      try {
        dataURL = `data:application/pdf;base64,${fs.readFileSync(pdfFilePath(cvID)).toString("base64")}`;
      } catch {
        return problem(404, "Không tìm thấy file preview cho CV này.");
      }
    }
    return NextResponse.json({
      cv_id: cv.id,
      filename: cv.filename,
      document_mime: cv.document_mime || "application/pdf",
      document_data_url: dataURL,
    });
  }

  return NextResponse.json({
    ...stripDocumentData(readDemoStore()),
    ai_rerank: aiRerankStatus(),
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const action = String(form.get("action") ?? "rank_once");
    const title = String(form.get("title") ?? "Ranking demo job").trim();
    const jd = String(form.get("jd") ?? "").trim();
    const jobID = String(form.get("job_id") ?? "").trim();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);

    if (action === "reset_store") {
      return NextResponse.json(resetDemoStore());
    }

    if (action === "create_job") {
      const job = await createJob(title, jd);
      return NextResponse.json({ job });
    }

    if (action === "upload_cvs") {
      const job = getJob(jobID);
      if (!job) {
        return problem(404, "Không tìm thấy JD để upload CV.");
      }
      if (files.length === 0) {
        return problem(422, "Chọn ít nhất một CV PDF hoặc DOCX.");
      }
      if (files.length > 50) {
        return problem(422, "Tối đa 50 CV mỗi lần upload.");
      }
      const { upload, storedCVs } = await analyzeFilesForJob(files, job);
      const updatedJob: StoredJob = {
        ...job,
        updated_at: new Date().toISOString(),
        cvs: [...storedCVs, ...job.cvs],
        cv_count: job.cvs.filter((cv) => cv.status !== "failed").length + upload.accepted,
      };
      saveJob(updatedJob);
      return NextResponse.json({ job: updatedJob, upload });
    }

    if (action === "run_ranking") {
      const job = getJob(jobID);
      if (!job) {
        return problem(404, "Không tìm thấy JD để chạy ranking.");
      }
      const updatedJob = await rankJob(job);
      return NextResponse.json({ job: updatedJob, run: updatedJob.latest_run, ai_rerank: aiRerankStatus() });
    }

    if (jd.length < 20) {
      return problem(422, "JD cần ít nhất 20 ký tự.");
    }
    if (files.length === 0) {
      return problem(422, "Chọn ít nhất một CV PDF hoặc DOCX.");
    }
    const job = await createJob(title, jd);
    const { upload, storedCVs } = await analyzeFilesForJob(files, job);
    const jobWithCVs: StoredJob = {
      ...job,
      cvs: storedCVs,
      cv_count: upload.accepted,
      updated_at: new Date().toISOString(),
    };
    saveJob(jobWithCVs);
    const rankedJob = await rankJob(jobWithCVs);
    return NextResponse.json({
      upload,
      run: rankedJob.latest_run,
      saved_job: rankedJob,
      job: rankedJob,
    });
  } catch (error) {
    return responseError(error);
  }
}
