"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  BriefcaseBusiness,
  Gauge,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  UploadCloud,
} from "@/components/icons";
import {
  loadStore,
  problemMessage,
  submitDemoForm,
  type FixtureManifest,
  type JobFixture,
  type JobResponse,
  type RunJobResponse,
  type StoredDemoJob,
  type UploadToJobResponse,
} from "@/lib/demo-ranking";

type DemoShellProps = {
  active: "jobs" | "new" | "detail";
  children: ReactNode;
  toolContent?: ReactNode;
};

export function DemoShell({ active, children, toolContent }: DemoShellProps) {
  const pathname = usePathname();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolStatus, setToolStatus] = useState("");
  const [toolError, setToolError] = useState("");
  const [toolBusy, setToolBusy] = useState(false);
  const [toolPosition, setToolPosition] = useState({ x: 24, y: 140 });
  const [dragging, setDragging] = useState(false);
  const [importJobs, setImportJobs] = useState<StoredDemoJob[]>([]);
  const [selectedImportJobID, setSelectedImportJobID] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importResult, setImportResult] = useState<UploadToJobResponse["upload"] | null>(null);
  const toolRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const suppressToolClickRef = useRef(false);
  const selectedImportJob = importJobs.find((job) => job.id === selectedImportJobID) ?? null;

  const refreshImportJobs = useCallback(async () => {
    try {
      const store = await loadStore();
      setImportJobs(store.jobs);
      setSelectedImportJobID((current) => {
        if (store.jobs.some((job) => job.id === current)) {
          return current;
        }
        const currentDetailJobID = pathname?.match(/^\/jobs\/([^/?#]+)/)?.[1];
        if (currentDetailJobID && store.jobs.some((job) => job.id === currentDetailJobID)) {
          return currentDetailJobID;
        }
        return store.jobs[0]?.id ?? "";
      });
    } catch (caught) {
      setToolError(problemMessage(caught));
    }
  }, [pathname]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setToolPosition({
        x: Math.max(16, window.innerWidth - 58),
        y: Math.max(88, Math.round(window.innerHeight * 0.58)),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (toolsOpen) {
      const timer = window.setTimeout(() => {
        void refreshImportJobs();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [refreshImportJobs, toolsOpen]);

  function openTools() {
    if (suppressToolClickRef.current) {
      suppressToolClickRef.current = false;
      return;
    }
    const panelHeight = toolContent ? 640 : 560;
    setToolPosition((current) => ({
      x: Math.min(current.x, Math.max(12, window.innerWidth - 354)),
      y: Math.min(current.y, Math.max(12, window.innerHeight - panelHeight)),
    }));
    setToolsOpen(true);
  }

  function clampToolPosition(x: number, y: number) {
    const rect = toolRef.current?.getBoundingClientRect();
    const width = rect?.width ?? (toolsOpen ? 330 : 44);
    const height = rect?.height ?? (toolsOpen ? (toolContent ? 640 : 560) : 42);
    return {
      x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - height - 12)),
    };
  }

  function beginDrag(event: PointerEvent<Element>) {
    const target = event.target as HTMLElement;
    if (target.closest("button,a,input,select,textarea") && !target.closest(".hr-tools-pill")) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = toolPosition;
    dragMovedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    function move(pointerEvent: globalThis.PointerEvent) {
      if (Math.abs(pointerEvent.clientX - startX) > 4 || Math.abs(pointerEvent.clientY - startY) > 4) {
        dragMovedRef.current = true;
      }
      setToolPosition(clampToolPosition(origin.x + pointerEvent.clientX - startX, origin.y + pointerEvent.clientY - startY));
    }

    function stop() {
      if (dragMovedRef.current) {
        suppressToolClickRef.current = true;
        window.setTimeout(() => {
          suppressToolClickRef.current = false;
        }, 250);
      }
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  async function resetWorkspace() {
    setToolBusy(true);
    setToolError("");
    setToolStatus("Đang làm sạch workspace...");
    try {
      const form = new FormData();
      form.append("action", "reset_store");
      await submitDemoForm(form);
      setToolStatus("Đã reset workspace.");
      window.location.assign("/jobs");
    } catch (caught) {
      setToolError(problemMessage(caught));
    } finally {
      setToolBusy(false);
    }
  }

  async function seedWorkspace() {
    setToolBusy(true);
    setToolError("");
    setToolStatus("Đang chuẩn bị dữ liệu mẫu...");
    try {
      const manifestResponse = await fetch("/ranking-fixtures/manifest.json", { cache: "no-store" });
      if (!manifestResponse.ok) {
        throw new Error("Không tải được bộ dữ liệu mẫu.");
      }
      const manifest = (await manifestResponse.json()) as FixtureManifest;

      const resetForm = new FormData();
      resetForm.append("action", "reset_store");
      await submitDemoForm(resetForm);

      for (const [index, fixtureSet] of manifest.sets.entries()) {
        setToolStatus(`Đang tạo JD ${index + 1}/${manifest.sets.length}: ${fixtureSet.name}`);
        const jobResponse = await fetch(fixtureSet.job_config_path, { cache: "no-store" });
        if (!jobResponse.ok) {
          throw new Error(`Không tải được JD ${fixtureSet.name}.`);
        }
        const job = (await jobResponse.json()) as JobFixture;

        const createForm = new FormData();
        createForm.append("action", "create_job");
        createForm.append("title", job.title);
        createForm.append("jd", job.description);
        const created = await submitDemoForm<JobResponse>(createForm);

        const files = await Promise.all(
          fixtureSet.cvs.map(async (cv) => {
            const cvResponse = await fetch(cv.path, { cache: "no-store" });
            if (!cvResponse.ok) {
              throw new Error(`Không tải được ${cv.name}.`);
            }
            const blob = await cvResponse.blob();
            return new File([blob], cv.name, { type: blob.type || "application/pdf" });
          }),
        );

        const uploadForm = new FormData();
        uploadForm.append("action", "upload_cvs");
        uploadForm.append("job_id", created.job.id);
        files.forEach((file) => uploadForm.append("files", file));
        await submitDemoForm<UploadToJobResponse>(uploadForm);

        const rankForm = new FormData();
        rankForm.append("action", "run_ranking");
        rankForm.append("job_id", created.job.id);
        await submitDemoForm<RunJobResponse>(rankForm);
      }

      setToolStatus("Đã sẵn sàng 6 JD và 24 CV.");
      window.location.assign("/jobs");
    } catch (caught) {
      setToolError(problemMessage(caught));
    } finally {
      setToolBusy(false);
    }
  }

  async function importCVsToJob() {
    if (!selectedImportJob) {
      setToolError("Chưa có JD để import CV. Tạo JD trước rồi upload CV vào vị trí đó.");
      return;
    }
    if (importFiles.length === 0) {
      setToolError("Chọn ít nhất một CV PDF hoặc DOCX.");
      return;
    }
    setToolBusy(true);
    setToolError("");
    setToolStatus(`Đang parse ${importFiles.length} CV cho “${selectedImportJob.title}”...`);
    try {
      const form = new FormData();
      form.append("action", "upload_cvs");
      form.append("job_id", selectedImportJob.id);
      importFiles.forEach((file) => form.append("files", file));
      const result = await submitDemoForm<UploadToJobResponse>(form);
      setImportResult(result.upload);
      setImportFiles([]);
      setToolStatus(`Đã lưu ${result.upload.accepted} CV vào “${result.job.title}”.`);
      window.location.assign(`/jobs/${result.job.id}`);
    } catch (caught) {
      setToolError(problemMessage(caught));
    } finally {
      setToolBusy(false);
    }
  }

  return (
    <main className="hr-tool">
      <aside className="hr-rail">
        <div className="hr-brand">
          <span>
            <Sparkles size={18} />
          </span>
          <div>
            <strong>TalentRank</strong>
            <small>Hiring workspace</small>
          </div>
        </div>

        <nav className="hr-nav" aria-label="Main navigation">
          <Link className={active === "jobs" ? "active" : ""} href="/jobs">
            <BriefcaseBusiness size={17} />
            Vị trí tuyển dụng
          </Link>
          <Link className={active === "new" ? "active" : ""} href="/jobs/new">
            <Plus size={17} />
            Tạo vị trí
          </Link>
        </nav>

        <div className="hr-rail-note">
          <Gauge size={16} />
          <span>Một JD có kho CV riêng. Ranking chỉ chạy trên CV thuộc JD đang mở.</span>
        </div>
      </aside>

      <section className="hr-workspace">
        <header className="hr-header">
          <div>
            <p className="hr-kicker">CV ranking module</p>
            <h1>Hiring Intelligence Workspace</h1>
            <p>Quản lý JD, lưu CV theo từng vị trí, xem trước hồ sơ và xếp hạng ứng viên dựa trên bằng chứng.</p>
          </div>
          <div className="hr-header-actions">
            <span className="hr-status-dot" />
            AI service ready
          </div>
        </header>

        {children}
      </section>

      <div
        ref={toolRef}
        className={`hr-tools-floating ${toolsOpen ? "open" : ""} ${dragging ? "dragging" : ""}`}
        style={{ left: toolPosition.x, top: toolPosition.y }}
      >
        {toolsOpen ? (
          <section className="hr-tools-panel" aria-label="Internal tools" onPointerDown={beginDrag}>
            <div className="hr-tools-handle">
              <span>
                <Settings size={15} />
                Internal tools
              </span>
              <button type="button" onClick={() => setToolsOpen(false)}>
                Thu gọn
              </button>
            </div>
            <p>Ẩn khỏi flow chính. Kéo vùng trống của panel để đặt lại vị trí.</p>
            <div className="hr-tools-actions">
              <button type="button" disabled={toolBusy} onClick={seedWorkspace}>
                <UploadCloud size={15} />
                Nạp dữ liệu mẫu
              </button>
              <button type="button" disabled={toolBusy} onClick={resetWorkspace}>
                <RotateCcw size={15} />
                Reset workspace
              </button>
            </div>
            <section className="hr-tool-upload">
              <p className="hr-kicker">CV intake</p>
              <h3>Import CV vào vị trí</h3>
              {importJobs.length > 0 ? (
                <>
                  <label className="hr-tool-select-label">
                    Chọn JD
                    <select value={selectedImportJobID} onChange={(event) => setSelectedImportJobID(event.target.value)}>
                      {importJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.title} · {job.cv_count} CV
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="hr-tool-dropzone" htmlFor="cv-files">
                    <UploadCloud size={20} />
                    <span>Chọn PDF/DOCX</span>
                    <small>{selectedImportJob ? `Sẽ lưu vào “${selectedImportJob.title}”` : "Chọn vị trí trước khi upload"}</small>
                  </label>
                  <input
                    id="cv-files"
                    className="hr-file-input"
                    type="file"
                    multiple
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) => setImportFiles(Array.from(event.target.files ?? []))}
                  />
                  <button className="hr-tool-primary" type="button" disabled={toolBusy} onClick={importCVsToJob}>
                    {toolBusy ? <RotateCcw size={15} /> : <UploadCloud size={15} />}
                    {toolBusy ? "Đang parse..." : "Lưu CV vào JD đã chọn"}
                  </button>
                  <div className="hr-tool-file-list">
                    {importFiles.length === 0 && <p>Chưa chọn CV mới.</p>}
                    {importFiles.map((file) => (
                      <span key={`${file.name}-${file.size}`}>{file.name}</span>
                    ))}
                  </div>
                  {importResult && (
                    <small>
                      {importResult.accepted} CV đã lưu · {importResult.failed} lỗi parse
                    </small>
                  )}
                </>
              ) : (
                <div className="hr-tool-empty">
                  <p>Chưa có JD nào để import CV.</p>
                  <Link href="/jobs/new">Tạo JD trước</Link>
                </div>
              )}
            </section>
            {toolContent && <div className="hr-tools-divider">{toolContent}</div>}
            {toolStatus && <small>{toolStatus}</small>}
            {toolError && <strong>{toolError}</strong>}
          </section>
        ) : (
          <button className="hr-tools-pill" type="button" aria-label="Tools" onPointerDown={beginDrag} onClick={openTools}>
            <Settings size={16} />
            <span>Tools</span>
          </button>
        )}
      </div>
    </main>
  );
}
