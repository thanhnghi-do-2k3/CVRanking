import type { RankingRun, UploadResponse } from "@/lib/ranking-types";

export const defaultJD = `About the role
We are hiring a Senior Backend Engineer to own high-volume production services for an internal hiring intelligence platform.

Key responsibilities
- Design and maintain REST APIs, background jobs and event-driven services.
- Improve PostgreSQL performance, Redis caching and service observability.
- Partner with product and data teams to ship reliable workflows for recruiters.

Requirements
- 5+ years building production backend systems.
- Strong experience with Go, PostgreSQL, Docker, Redis and REST API design.
- Comfortable with monitoring, debugging and performance tuning.

Nice to have
- Kubernetes, AWS and experience operating multi-service platforms.`;

export type StoredCV = UploadResponse["items"][number] & {
  id: string;
  resume_id: string;
  preview_text?: string;
  document_mime?: string;
  has_document_preview?: boolean;
  uploaded_at: string;
  total_years_experience?: number | null;
};

export type StoredDemoJob = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  parser_version: string;
  cv_count: number;
  cvs: StoredCV[];
  latest_run: RankingRun | null;
};

export type DemoStoreResponse = {
  jobs: StoredDemoJob[];
};

export type JobResponse = {
  job: StoredDemoJob;
};

export type UploadToJobResponse = {
  job: StoredDemoJob;
  upload: UploadResponse;
};

export type RunJobResponse = {
  job: StoredDemoJob;
  run: RankingRun;
};

export type CVDocumentPreview = {
  cv_id: string;
  filename: string;
  document_mime?: string;
  document_data_url: string;
};

export type FixtureCV = {
  name: string;
  candidate: string;
  path: string;
};

export type FixtureSet = {
  id: string;
  name: string;
  description: string;
  job_config_path: string;
  expected_top: string;
  cvs: FixtureCV[];
};

export type FixtureManifest = {
  sets: FixtureSet[];
};

export type JobFixture = {
  title: string;
  description: string;
};

export function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function problemMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không thể xử lý request.";
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function loadStore() {
  const response = await fetch("/api/ranking-test", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Không tải được kho JD/CV.");
  }
  return (await response.json()) as DemoStoreResponse;
}

export async function submitDemoForm<T>(form: FormData) {
  const response = await fetch("/api/ranking-test", {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? "Không thể xử lý request.");
  }
  return payload as T;
}

export async function loadCVDocument(cvID: string) {
  const response = await fetch(`/api/ranking-test?document=1&cv_id=${encodeURIComponent(cvID)}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? "Không tải được file preview.");
  }
  return payload as CVDocumentPreview;
}
