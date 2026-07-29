"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, FileSearch, Plus, RotateCcw } from "@/components/icons";
import { DemoShell } from "@/components/demo-shell";
import {
  formatTime,
  loadStore,
  percent,
  problemMessage,
  type StoredDemoJob,
} from "@/lib/demo-ranking";

export default function JobsPage() {
  const [jobs, setJobs] = useState<StoredDemoJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const store = await loadStore();
      setJobs(store.jobs ?? []);
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <DemoShell active="jobs">
      {error && (
        <div className="hr-alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <section className="hr-library">
        <div className="hr-section-head">
          <div>
            <p className="hr-kicker">JD storage</p>
            <h2>Danh sách vị trí tuyển dụng</h2>
          </div>
          <div className="hr-section-actions">
            <button type="button" onClick={refresh}>
              <RotateCcw size={16} />
              {loading ? "Đang tải..." : "Refresh"}
            </button>
            <Link className="hr-dark-link" href="/jobs/new">
              <Plus size={16} />
              Tạo JD mới
            </Link>
          </div>
        </div>

        {jobs.length === 0 && (
          <div className="hr-empty">
            <BriefcaseBusiness size={22} />
            <p>Chưa có JD nào. Vào “Tạo JD” để lưu JD đầu tiên.</p>
          </div>
        )}

        <div className="hr-library-list">
          {jobs.map((job) => {
            const topResult = job.latest_run?.results?.[0];
            return (
              <article className="hr-library-job" key={job.id}>
                <div className="hr-library-job-head">
                  <div>
                    <strong>{job.title}</strong>
                    <small>
                      {job.cv_count} CV thuộc JD · tạo lúc {formatTime(job.created_at)}
                    </small>
                  </div>
                  {topResult ? (
                    <span>
                      Top: {topResult.candidate.full_name} · {percent(topResult.final_score)}
                    </span>
                  ) : (
                    <span>Chưa ranking</span>
                  )}
                </div>
                <p>{job.description}</p>
                <Link className="hr-library-link" href={`/jobs/${job.id}`}>
                  <FileSearch size={16} />
                  Mở kho CV và ranking
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </DemoShell>
  );
}
