"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  FileText,
  FileSearch,
  Loader2,
  Play,
  Search,
  Trophy,
  UploadCloud,
  X,
  XCircle,
} from "@/components/icons";
import { DemoShell } from "@/components/demo-shell";
import {
  formatTime,
  loadCVDocument,
  loadStore,
  percent,
  problemMessage,
  submitDemoForm,
  type AiRerankStatus,
  type CVDocumentPreview,
  type RunJobResponse,
  type StoredCV,
  type StoredDemoJob,
} from "@/lib/demo-ranking";
import type { RankingRun, RankingResult } from "@/lib/ranking-types";

const RANKING_STEPS = [
  "Đang tải hồ sơ ứng viên & yêu cầu JD...",
  "Đang so khớp kỹ năng, học vấn, chứng chỉ, ngoại ngữ...",
  "Đang tính điểm theo trọng số từng tiêu chí...",
  "Đang tổng hợp điểm mạnh & khoảng trống...",
  "Đang xếp hạng ứng viên...",
];
const RANKING_STEP_INTERVAL_MS = 550;

const REQUIREMENT_STATUS_LABEL: Record<string, string> = {
  met: "Đáp ứng",
  partially_met: "Đáp ứng một phần",
  not_found: "Chưa tìm thấy",
  not_met: "Không đáp ứng",
  unknown: "Chưa rõ",
};

const ELIGIBILITY_LABEL: Record<string, string> = {
  eligible: "Đủ điều kiện",
  potentially_eligible: "Có thể phù hợp",
  constraint_unknown: "Chưa rõ điều kiện bắt buộc",
  constraint_failed: "Không đạt điều kiện bắt buộc",
};

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
  const [rankingStep, setRankingStep] = useState(0);
  const [activeTab, setActiveTab] = useState<"cvs" | "results">("cvs");
  const [previewCV, setPreviewCV] = useState<StoredCV | null>(null);
  const [previewDocument, setPreviewDocument] = useState<CVDocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [aiRerank, setAiRerank] = useState<AiRerankStatus | null>(null);
  const rankingStepTimer = useRef<number | null>(null);

  const rankingResults = useMemo(() => job?.latest_run?.results ?? run?.results ?? [], [job, run]);

  const previewResult = useMemo(() => {
    if (!previewCV) {
      return null;
    }
    return (
      rankingResults.find(
        (result) => result.candidate.id === previewCV.candidate_id || result.candidate.resume_id === previewCV.resume_id,
      ) ?? null
    );
  }, [previewCV, rankingResults]);

  const requirementNameByKey = useMemo(
    () => new Map((job?.requirements ?? []).map((requirement) => [requirement.requirement_key, requirement.name])),
    [job?.requirements],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const store = await loadStore();
      const found = store.jobs.find((item) => item.id === jobId) ?? null;
      setJob(found);
      setRun(found?.latest_run ?? null);
      setAiRerank(store.ai_rerank);
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

  useEffect(() => {
    return () => {
      if (rankingStepTimer.current !== null) {
        window.clearInterval(rankingStepTimer.current);
      }
    };
  }, []);

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
    setRankingStep(0);
    setActiveTab("results");
    rankingStepTimer.current = window.setInterval(() => {
      setRankingStep((current) => Math.min(current + 1, RANKING_STEPS.length - 1));
    }, RANKING_STEP_INTERVAL_MS);
    const minDuration = new Promise((resolve) => {
      window.setTimeout(resolve, RANKING_STEPS.length * RANKING_STEP_INTERVAL_MS);
    });
    try {
      const form = new FormData();
      form.append("action", "run_ranking");
      form.append("job_id", job.id);
      const [result] = await Promise.all([submitDemoForm<RunJobResponse>(form), minDuration]);
      setJob(result.job);
      setRun(result.run);
      setAiRerank(result.ai_rerank);
      setNotice(`Ranking xong cho JD “${result.job.title}”.`);
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      if (rankingStepTimer.current !== null) {
        window.clearInterval(rankingStepTimer.current);
        rankingStepTimer.current = null;
      }
      setRanking(false);
      setRankingStep(0);
    }
  }

  async function copyEvaluation(cv: StoredCV, result: RankingResult) {
    const lines = [
      `Đánh giá ứng viên: ${cv.full_name || cv.filename}`,
      job ? `Vị trí: ${job.title}` : null,
      `Điểm phù hợp: ${percent(result.final_score)} · ${ELIGIBILITY_LABEL[result.eligibility_status] ?? result.eligibility_status}`,
      "",
      "Điểm mạnh:",
      ...(result.strengths.length ? result.strengths.map((item) => `- ${item}`) : ["- (chưa có)"]),
      "",
      "Khoảng trống:",
      ...(result.gaps.length ? result.gaps.map((item) => `- ${item}`) : ["- (không có)"]),
      ...(result.unknowns.length ? ["", "Chưa xác minh:", ...result.unknowns.map((item) => `- ${item}`)] : []),
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      window.setTimeout(() => setCopyState("idle"), 2200);
    }
  }

  async function openPreviewCV(cv: StoredCV) {
    setPreviewCV(cv);
    setPreviewDocument(null);
    setPanelOpen(true);
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
      {aiRerank && !aiRerank.available && (
        <div className="hr-info">
          <CircleHelp size={16} />
          Chưa cấu hình API key AI (GEMINI_API_KEY hoặc GROQ_API_KEY) — ranking sẽ chỉ dùng thuật toán
          baseline (rule-based), không qua bước AI rerank.
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

          <div className="hr-view-switch">
            <div className="hr-view-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "cvs"}
                className={activeTab === "cvs" ? "active" : ""}
                onClick={() => setActiveTab("cvs")}
              >
                <FileText size={14} />
                Kho CV
                <span className="hr-tab-count">{job.cv_count}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "results"}
                className={activeTab === "results" ? "active" : ""}
                onClick={() => setActiveTab("results")}
              >
                <Trophy size={14} />
                Kết quả ranking
                <span className="hr-tab-count">{rankingResults.length}</span>
              </button>
            </div>
            <button type="button" disabled={job.cv_count === 0 || ranking} onClick={runRanking}>
              {ranking ? <Loader2 size={16} className="hr-spin" /> : <Play size={16} />}
              {ranking ? "Đang ranking..." : "Chạy ranking"}
            </button>
          </div>

          <section className="hr-focus-grid">
            {activeTab === "cvs" && (
              <section className="hr-cv-storage">
                <div className="hr-section-head">
                  <div>
                    <p className="hr-kicker">CV thuộc JD này</p>
                    <h2>Kho CV của {job.title}</h2>
                  </div>
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
            )}

            {activeTab === "results" && (
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

                {ranking && (
                  <div className="hr-ranking-progress">
                    <div className="hr-ranking-progress-bar">
                      <i />
                    </div>
                    <ul>
                      {RANKING_STEPS.map((step, index) => (
                        <li
                          key={step}
                          className={index < rankingStep ? "done" : index === rankingStep ? "active" : "pending"}
                        >
                          {index < rankingStep ? (
                            <CheckCircle2 size={15} />
                          ) : index === rankingStep ? (
                            <Loader2 size={15} className="hr-spin" />
                          ) : (
                            <span className="hr-step-dot" />
                          )}
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!ranking && rankingResults.length === 0 && (
                  <div className="hr-empty">
                    <Search size={22} />
                    <p>Chưa có ranking. Import CV rồi bấm “Chạy ranking”.</p>
                  </div>
                )}

                {!ranking && rankingResults.map((result) => (
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
            )}
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

                <div className="hr-preview-stage">
                  {previewLoading && <div className="hr-preview-loading">Đang tải bản PDF preview...</div>}
                  {!previewLoading && previewDocument?.document_data_url && (
                    <iframe
                      className="hr-preview-pdf"
                      src={previewDocument.document_data_url}
                      title={`CV gốc — ${previewCV.filename}`}
                    />
                  )}
                  {!previewLoading && !previewDocument?.document_data_url && (
                    <div className="hr-preview-fallback">
                      <ParsedResumePreview
                        cv={previewCV}
                        result={previewResult}
                        requirementNameByKey={requirementNameByKey}
                        copyState={copyState}
                        onCopyEvaluation={() => previewResult && void copyEvaluation(previewCV, previewResult)}
                      />
                    </div>
                  )}

                  {previewCV.has_document_preview && (
                    <aside className={`hr-floating-panel${panelOpen ? " open" : ""}`}>
                      <button
                        type="button"
                        className="hr-panel-toggle"
                        aria-label={panelOpen ? "Đóng thông tin ứng viên" : "Mở thông tin ứng viên"}
                        onClick={() => setPanelOpen((current) => !current)}
                      >
                        {panelOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                      </button>
                      <div className="hr-floating-panel-body">
                        <div className="hr-preview-meta">
                          <span>{previewCV.status === "ready" ? "Parsed" : "Parse issue"}</span>
                          {previewCV.total_years_experience != null && (
                            <span>{previewCV.total_years_experience} năm kinh nghiệm</span>
                          )}
                          {previewCV.skills?.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}
                        </div>
                        <ParsedResumePreview
                          cv={previewCV}
                          result={previewResult}
                          requirementNameByKey={requirementNameByKey}
                          copyState={copyState}
                          onCopyEvaluation={() => previewResult && void copyEvaluation(previewCV, previewResult)}
                        />
                      </div>
                    </aside>
                  )}
                </div>
              </aside>
            </div>
          )}
        </>
      )}
    </DemoShell>
  );
}

function ParsedResumePreview({
  cv,
  result,
  requirementNameByKey,
  copyState,
  onCopyEvaluation,
}: {
  cv: StoredCV;
  result: RankingResult | null;
  requirementNameByKey: Map<string, string>;
  copyState: "idle" | "copied" | "failed";
  onCopyEvaluation: () => void;
}) {
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

      <section className="hr-eval-section">
        <div className="hr-eval-head">
          <h4>Đánh giá ranking</h4>
          {result && (
            <button type="button" className="hr-copy-eval" onClick={onCopyEvaluation}>
              <Copy size={13} />
              {copyState === "copied"
                ? "Đã sao chép!"
                : copyState === "failed"
                  ? "Không sao chép được"
                  : "Sao chép để gửi"}
            </button>
          )}
        </div>
        {!result ? (
          <p>Chưa có kết quả ranking cho CV này. Chạy ranking để xem đánh giá chi tiết.</p>
        ) : (
          <>
            <div className="hr-eval-score">
              <span>{percent(result.final_score)}</span>
              <span className={`hr-eligibility ${result.eligibility_status}`}>
                {ELIGIBILITY_LABEL[result.eligibility_status] ?? result.eligibility_status}
              </span>
              <small>Độ tin cậy {percent(result.confidence)}</small>
            </div>
            <div className="hr-reason-grid">
              <section>
                <h3>Điểm mạnh</h3>
                {result.strengths.length ? (
                  result.strengths.map((item) => (
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
                  result.gaps.map((item) => <p key={item}>{item}</p>)
                ) : (
                  <p>Không có khoảng trống lớn.</p>
                )}
              </section>
            </div>
            {result.unknowns.length > 0 && (
              <p className="hr-eval-unknowns">
                <XCircle size={14} />
                {result.unknowns.join(" · ")}
              </p>
            )}
            {result.requirement_scores.length > 0 && (
              <div className="hr-requirement-list">
                {result.requirement_scores.map((score) => (
                  <div key={score.requirement_key} className={`hr-requirement-row ${score.status}`}>
                    <span>{requirementNameByKey.get(score.requirement_key) ?? score.requirement_key}</span>
                    <span>{REQUIREMENT_STATUS_LABEL[score.status] ?? score.status}</span>
                    <span>{percent(score.score)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
