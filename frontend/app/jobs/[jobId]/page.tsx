"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileSearch,
  Play,
  RotateCcw,
  Search,
  UploadCloud,
  X,
} from "@/components/icons";
import { DemoShell } from "@/components/demo-shell";
import {
  formatTime,
  loadCVDocument,
  loadStore,
  percent,
  problemMessage,
  submitDemoForm,
  type CVDocumentPreview,
  type RunJobResponse,
  type StoredCV,
  type StoredDemoJob,
} from "@/lib/demo-ranking";
import type { RankingRun } from "@/lib/ranking-types";

type JobDetailPageProps = {
  params: Promise<{ jobId: string }>;
};

export default function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = use(params);
  const [job, setJob] = useState<StoredDemoJob | null>(null);
  const [run, setRun] = useState<RankingRun | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [previewCV, setPreviewCV] = useState<StoredCV | null>(null);
  const [previewDocument, setPreviewDocument] = useState<CVDocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const rankingResults = job?.latest_run?.results ?? run?.results ?? [];

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const store = await loadStore();
      const found = store.jobs.find((item) => item.id === jobId) ?? null;
      setJob(found);
      setRun(found?.latest_run ?? null);
      setPreviewCV((current) => (current && found?.cvs.some((cv) => cv.id === current.id) ? current : null));
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function runRanking() {
    if (!job) {
      setError("Không tìm thấy JD này.");
      return;
    }
    if (job.cv_count === 0) {
      setError("JD này chưa có CV nào. Import CV trước rồi mới ranking.");
      return;
    }
    setError("");
    setNotice("");
    setRanking(true);
    try {
      const form = new FormData();
      form.append("action", "run_ranking");
      form.append("job_id", job.id);
      const result = await submitDemoForm<RunJobResponse>(form);
      setJob(result.job);
      setRun(result.run);
      setNotice(`Ranking xong cho JD “${result.job.title}”.`);
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setRanking(false);
    }
  }

  async function openPreviewCV(cv: StoredCV) {
    setPreviewCV(cv);
    setPreviewDocument(null);
    if (!cv.has_document_preview) {
      return;
    }
    setPreviewLoading(true);
    try {
      const documentPreview = await loadCVDocument(cv.id);
      setPreviewDocument(documentPreview);
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreviewCV() {
    setPreviewCV(null);
    setPreviewDocument(null);
    setPreviewLoading(false);
  }

  return (
    <DemoShell active="detail">
      {error && (
        <div className="hr-alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="hr-notice">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      {!job && !loading && (
        <section className="hr-library">
          <div className="hr-empty">
            <Search size={22} />
            <p>Không tìm thấy JD này. Quay lại kho JD để chọn JD khác.</p>
            <Link className="hr-library-link" href="/jobs">
              Về kho JD
            </Link>
          </div>
        </section>
      )}

      {job && (
        <>
          <section className="hr-job-hero">
            <div>
              <p className="hr-kicker">JD detail</p>
              <h2>{job.title}</h2>
              <p>{job.description}</p>
            </div>
            <div>
              <small>CV thuộc JD</small>
              <strong>{job.cv_count}</strong>
            </div>
          </section>

          <section className="hr-focus-grid">
            <section className="hr-cv-storage">
              <div className="hr-section-head">
                <div>
                  <p className="hr-kicker">CV thuộc JD này</p>
                  <h2>Kho CV của {job.title}</h2>
                </div>
                <button type="button" disabled={job.cv_count === 0 || ranking} onClick={runRanking}>
                  {ranking ? <RotateCcw size={16} /> : <Play size={16} />}
                  {ranking ? "Đang ranking..." : "Chạy ranking"}
                </button>
              </div>
              {job.cvs.length === 0 && (
                <div className="hr-empty">
                  <UploadCloud size={22} />
                  <p>JD này chưa có CV. Mở Tools để import CV vào JD hiện tại.</p>
                </div>
              )}
              {job.cvs.length > 0 && (
                <div className="hr-saved-cvs">
                  {job.cvs.map((cv) => (
                    <div key={cv.id}>
                      <FileText size={15} />
                      <span>
                        <strong>{cv.full_name || cv.filename}</strong>
                        <small>
                          {cv.filename}
                          {cv.skills?.length ? ` · ${cv.skills.slice(0, 5).join(", ")}` : ""}
                          {cv.status === "failed" ? ` · lỗi: ${cv.error}` : ""}
                        </small>
                      </span>
                      <button className="hr-preview-button" type="button" onClick={() => void openPreviewCV(cv)}>
                        <FileSearch size={14} />
                        Preview
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="hr-results">
            <div className="hr-section-head">
              <div>
                <p className="hr-kicker">Ranking output</p>
                <h2>Kết quả ranking cho JD này</h2>
              </div>
              {job.latest_run && (
                <div className="hr-ranking-meta">
                  <span className={job.latest_run.model_version.includes("ai-rerank") ? "ai" : "baseline"}>
                    {job.latest_run.model_version.startsWith("gemini-ai-rerank")
                      ? "AI Gemini ranking"
                      : job.latest_run.model_version.startsWith("groq-ai-rerank")
                        ? "AI Groq ranking"
                        : "Baseline fallback"}
                  </span>
                  <small>
                    {job.latest_run.candidate_count} CV ranked ·{" "}
                    {formatTime(job.latest_run.finished_at ?? job.latest_run.created_at)}
                  </small>
                </div>
              )}
            </div>

            {rankingResults.length === 0 && (
              <div className="hr-empty">
                <Search size={22} />
                <p>Chưa có ranking. Import CV rồi bấm “Chạy ranking”.</p>
              </div>
            )}

            {rankingResults.map((result) => (
              <article className="hr-result-row" key={result.id}>
                <div className="hr-rank">#{result.rank}</div>
                <div className="hr-result-main">
                  <div className="hr-result-top">
                    <div>
                      <strong>{result.candidate.full_name}</strong>
                      <small>{result.candidate.current_title || result.candidate.filename}</small>
                    </div>
                    <span>{percent(result.final_score)}</span>
                  </div>
                  <div className="hr-score-track">
                    <i style={{ width: percent(result.final_score) }} />
                  </div>
                  <div className="hr-reason-grid">
                    <section>
                      <h3>Điểm mạnh</h3>
                      {result.strengths.length ? (
                        result.strengths.slice(0, 4).map((item) => (
                          <p key={item}>
                            <CheckCircle2 size={14} />
                            {item}
                          </p>
                        ))
                      ) : (
                        <p>Chưa tìm thấy điểm mạnh rõ ràng.</p>
                      )}
                    </section>
                    <section>
                      <h3>Khoảng trống</h3>
                      {result.gaps.length ? (
                        result.gaps.slice(0, 4).map((item) => <p key={item}>{item}</p>)
                      ) : (
                        <p>Không có khoảng trống lớn.</p>
                      )}
                    </section>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {previewCV && (
            <div className="hr-preview-overlay" role="dialog" aria-modal="true" aria-label={`Preview ${previewCV.filename}`}>
              <aside className="hr-preview-drawer">
                <div className="hr-preview-head">
                  <div>
                    <p className="hr-kicker">CV preview</p>
                    <h2>{previewCV.full_name || previewCV.filename}</h2>
                    <small>{previewCV.current_title || previewCV.filename}</small>
                  </div>
                  <button type="button" aria-label="Đóng preview CV" onClick={closePreviewCV}>
                    <X size={18} />
                  </button>
                </div>
                <div className="hr-preview-meta">
                  <span>{previewCV.status === "ready" ? "Parsed" : "Parse issue"}</span>
                  {previewCV.total_years_experience != null && <span>{previewCV.total_years_experience} năm kinh nghiệm</span>}
                  {previewCV.skills?.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}
                  {previewDocument?.document_data_url && (
                    <a href={previewDocument.document_data_url} target="_blank" rel="noreferrer">
                      Mở PDF gốc
                    </a>
                  )}
                </div>
                {previewLoading && <div className="hr-preview-loading">Đang tải bản PDF preview...</div>}
                {!previewLoading && <ParsedResumePreview cv={previewCV} />}
              </aside>
            </div>
          )}
        </>
      )}
    </DemoShell>
  );
}

function ParsedResumePreview({ cv }: { cv: StoredCV }) {
  const lines = (cv.preview_text || "Chưa có nội dung preview cho CV này.")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headings = new Set(["PROFILE", "SELECTED IMPACT", "CORE SKILLS", "EXPERIENCE HIGHLIGHTS", "SIGNALS FOR TALENTRANK"]);
  const firstHeadingIndex = lines.findIndex((line) => headings.has(line.toUpperCase()));
  const introLines = firstHeadingIndex > 0 ? lines.slice(0, firstHeadingIndex) : [];
  const sections: Array<{ title: string; items: string[] }> = [];
  let current: { title: string; items: string[] } | null = null;

  for (const line of lines) {
    if (headings.has(line.toUpperCase())) {
      current = { title: line, items: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.items.push(line.replace(/^[-•]\s*/, ""));
    }
  }

  return (
    <div className="hr-parsed-resume">
      <div className="hr-parsed-resume-hero">
        <div>
          <span>{(cv.full_name || cv.filename).slice(0, 1).toUpperCase()}</span>
        </div>
        <div>
          <h3>{cv.full_name || introLines[0] || cv.filename}</h3>
          <p>{cv.current_title || introLines[1] || cv.filename}</p>
          {introLines[2] && <small>{introLines[2]}</small>}
        </div>
      </div>
      {sections.filter((section) => section.items.length > 0).length > 0 ? (
        sections.filter((section) => section.items.length > 0).map((section) => (
          <section key={section.title}>
            <h4>{section.title}</h4>
            {section.title.toUpperCase() === "CORE SKILLS" ? (
              <div className="hr-parsed-skills">
                {section.items.map((item) => (
                  <span key={`${section.title}-${item}`}>{item}</span>
                ))}
              </div>
            ) : (
              section.items.map((item) => <p key={`${section.title}-${item}`}>{item}</p>)
            )}
          </section>
        ))
      ) : (
        <section>
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}
    </div>
  );
}
