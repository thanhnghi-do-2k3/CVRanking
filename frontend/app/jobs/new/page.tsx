"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, FileText, RotateCcw, Sparkles } from "@/components/icons";
import { DemoShell } from "@/components/demo-shell";
import {
  defaultJD,
  problemMessage,
  submitDemoForm,
  type JobResponse,
} from "@/lib/demo-ranking";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("Senior Backend Engineer");
  const [jd, setJD] = useState(defaultJD);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [assistantThreadID, setAssistantThreadID] = useState("");
  const [assistantInstruction, setAssistantInstruction] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantMeta, setAssistantMeta] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [outline, setOutline] = useState({
    experience: "5+ years",
    mustHave: "Go, PostgreSQL, Docker, Redis, REST API design",
    niceHave: "Kubernetes, AWS, observability",
    domain: "internal hiring intelligence platform",
  });
  const previewLines = jd
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  async function createJD() {
    setError("");
    setNotice("");
    if (jd.trim().length < 20) {
      setError("JD cần ít nhất 20 ký tự.");
      return null;
    }
    setCreating(true);
    try {
      const form = new FormData();
      form.append("action", "create_job");
      form.append("title", title.trim() || "Untitled role");
      form.append("jd", jd.trim());
      const result = await submitDemoForm<JobResponse>(form);
      setNotice(`Đã lưu JD “${result.job.title}”.`);
      router.push(`/jobs/${result.job.id}`);
      return result.job;
    } catch (caught) {
      setError(problemMessage(caught));
      return null;
    } finally {
      setCreating(false);
    }
  }

  function formatJD() {
    const headings = new Set(["about the role", "key responsibilities", "responsibilities", "requirements", "nice to have"]);
    const formatted = jd
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const normalized = line.toLowerCase().replace(/:$/, "");
        if (headings.has(normalized)) {
          return `${line.replace(/:$/, "")}\n`;
        }
        if (/^[-•]\s*/.test(line)) {
          return `- ${line.replace(/^[-•]\s*/, "")}`;
        }
        return line;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n(About the role|Key responsibilities|Responsibilities|Requirements|Nice to have)/g, "\n\n$1")
      .trim();
    setJD(formatted);
  }

  function generateJDFromOutline() {
    const role = title.trim() || "Untitled role";
    const mustHave = outline.mustHave
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const niceHave = outline.niceHave
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const mainSkills = mustHave.length ? mustHave.join(", ") : "core skills relevant to the role";
    const platform = outline.domain.trim() || "the product platform";
    const experience = outline.experience.trim() || "3+ years";

    setJD(`About the role
We are hiring a ${role} to help build and improve ${platform}.

Key responsibilities
- Own high-impact product and technical work for the ${role} function.
- Collaborate with product, design and engineering teams to ship reliable workflows.
- Improve quality, maintainability and operational visibility for the systems you own.

Requirements
- ${experience} of relevant production experience.
- Strong hands-on experience with ${mainSkills}.
- Able to communicate trade-offs clearly and work well in a cross-functional team.

Nice to have
${niceHave.length ? niceHave.map((item) => `- ${item}`).join("\n") : "- Experience with adjacent tools, cloud platforms or analytics workflows."}`);
  }

  async function askJDAssistant(instruction = assistantInstruction) {
    const trimmed = instruction.trim();
    if (!trimmed) {
      setError("Nhập yêu cầu bạn muốn AI chỉnh JD.");
      return;
    }
    setError("");
    setNotice("");
    setAssistantBusy(true);
    try {
      const response = await fetch("/api/jd-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: assistantThreadID || undefined,
          title,
          jd,
          message: trimmed,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? "Không thể gọi JD assistant.");
      }
      setAssistantThreadID(payload.thread_id);
      setAssistantReply(payload.reply);
      setAssistantDraft(payload.revised_jd);
      setAssistantMeta(
        payload.provider === "gemini"
          ? `Gemini · ${payload.model} · nhớ ${payload.turns} lượt`
          : `Fallback local · ${payload.model} · ${payload.gemini_configured ? "Gemini lỗi/limit" : "chưa cấu hình key"}`,
      );
      setAssistantInstruction("");
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setAssistantBusy(false);
    }
  }

  function applyAssistantDraft() {
    if (!assistantDraft) {
      return;
    }
    setJD(assistantDraft);
    setNotice("Đã áp dụng bản JD do assistant đề xuất.");
  }

  return (
    <DemoShell active="new">
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

      <section className="hr-jd-studio">
        <article className="hr-card hr-jd-editor">
          <div className="hr-card-heading">
            <span>01</span>
            <div>
              <p className="hr-kicker">Create role</p>
              <h2>Tạo JD tuyển dụng</h2>
              <small>Soạn JD rõ ràng để hệ thống parse yêu cầu và ranking CV chính xác hơn.</small>
            </div>
          </div>

          <div className="hr-jd-quickbar">
            <button className="hr-soft-action" type="button" onClick={() => setOutlineOpen((current) => !current)}>
              <Sparkles size={15} />
              {outlineOpen ? "Ẩn sườn JD" : "Nhập sườn JD"}
            </button>
            <span>Điền vài ý chính để tự tạo bản JD hoàn chỉnh.</span>
          </div>

          <section className="hr-jd-assistant" aria-label="AI hỗ trợ chỉnh JD">
            <div>
              <p className="hr-kicker">AI JD assistant</p>
              <h3>Nhờ AI chỉnh JD theo yêu cầu</h3>
              <small>Assistant nhớ ngữ cảnh vài lượt trong phiên này, ví dụ: “giữ seniority như cũ nhưng thêm Kubernetes”.</small>
            </div>
            <div className="hr-assistant-prompts">
              {[
                "Làm JD chuyên nghiệp hơn và rõ tiêu chí ranking",
                "Rút gọn nhưng vẫn giữ must-have",
                "Thêm yêu cầu Kubernetes như nice-to-have",
                "Dịch JD sang tiếng Việt tự nhiên",
              ].map((prompt) => (
                <button key={prompt} type="button" disabled={assistantBusy} onClick={() => void askJDAssistant(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
            <div className="hr-assistant-input">
              <input
                value={assistantInstruction}
                placeholder="Ví dụ: thêm phần trách nhiệm về observability nhưng đừng đổi seniority..."
                onChange={(event) => setAssistantInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void askJDAssistant();
                  }
                }}
              />
              <button type="button" disabled={assistantBusy} onClick={() => void askJDAssistant()}>
                {assistantBusy ? <RotateCcw size={15} /> : <Sparkles size={15} />}
                {assistantBusy ? "Đang suy nghĩ..." : "Gửi"}
              </button>
            </div>
            {assistantReply && (
              <div className="hr-assistant-result">
                <span>{assistantMeta}</span>
                <p>{assistantReply}</p>
                <button type="button" onClick={applyAssistantDraft}>
                  Áp dụng bản AI vào JD
                </button>
              </div>
            )}
          </section>

          {outlineOpen && (
            <section className="hr-jd-outline" aria-label="Tạo JD nhanh từ sườn">
            <div>
              <p className="hr-kicker">JD skeleton</p>
              <h3>Nhập sườn nhanh</h3>
            </div>
            <div className="hr-outline-grid">
              <label>
                Kinh nghiệm
                <input
                  value={outline.experience}
                  onChange={(event) => setOutline((current) => ({ ...current, experience: event.target.value }))}
                />
              </label>
              <label>
                Kỹ năng bắt buộc
                <input
                  value={outline.mustHave}
                  onChange={(event) => setOutline((current) => ({ ...current, mustHave: event.target.value }))}
                />
              </label>
              <label>
                Nice to have
                <input
                  value={outline.niceHave}
                  onChange={(event) => setOutline((current) => ({ ...current, niceHave: event.target.value }))}
                />
              </label>
              <label>
                Bối cảnh sản phẩm
                <input
                  value={outline.domain}
                  onChange={(event) => setOutline((current) => ({ ...current, domain: event.target.value }))}
                />
              </label>
            </div>
            <button className="hr-soft-action" type="button" onClick={generateJDFromOutline}>
              <Sparkles size={15} />
              Tự hoàn thành JD
            </button>
            </section>
          )}

          <label>
            Tên vị trí
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <div className="hr-field hr-jd-editor-field">
            <label htmlFor="jd-body">Nội dung JD</label>
            <textarea id="jd-body" value={jd} rows={18} onChange={(event) => setJD(event.target.value)} />
          </div>

          <div className="hr-editor-actions">
            <button className="hr-soft-action" type="button" onClick={formatJD}>
              <FileText size={15} />
              Format JD
            </button>
            <button className="hr-primary-action" type="button" disabled={creating} onClick={createJD}>
              {creating ? <RotateCcw size={17} /> : <BriefcaseBusiness size={17} />}
              {creating ? "Đang lưu JD..." : "Lưu JD và mở kho CV"}
            </button>
          </div>
        </article>

        <aside className="hr-jd-preview-card">
          <div className="hr-jd-preview-top">
            <p className="hr-kicker">Live preview</p>
            <h2>{title || "Untitled role"}</h2>
            <span>Ready for CV ranking</span>
          </div>
          <div className="hr-jd-preview-body">
            {previewLines.slice(0, 18).map((line, index) => {
              const isHeading = ["about the role", "key responsibilities", "responsibilities", "requirements", "nice to have"].includes(
                line.toLowerCase().replace(/:$/, ""),
              );
              return isHeading ? <h3 key={`${line}-${index}`}>{line.replace(/:$/, "")}</h3> : <p key={`${line}-${index}`}>{line}</p>;
            })}
          </div>
          <div className="hr-jd-tips">
            <strong>Gợi ý JD tốt</strong>
            <p>Nêu rõ trách nhiệm, kỹ năng bắt buộc, số năm kinh nghiệm và các điểm “nice to have”.</p>
          </div>
        </aside>
      </section>
    </DemoShell>
  );
}
