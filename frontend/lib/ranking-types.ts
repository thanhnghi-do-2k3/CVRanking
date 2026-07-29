export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";

export type Requirement = {
  id?: string;
  requirement_key: string;
  name: string;
  requirement_type: string;
  priority: "must_have" | "nice_to_have";
  weight: number;
  minimum_years?: number | null;
  is_hard_constraint: boolean;
  description: string;
};

export type JobListItem = {
  id: string;
  title: string;
  location: string;
  employment_type: EmploymentType;
  status: string;
  candidate_count: number;
  last_ranking_at?: string | null;
  created_at: string;
};

export type JobDetail = JobListItem & {
  description: string;
  summary: string;
  seniority?: string | null;
  current_version: number;
  requirements: Requirement[];
  updated_at: string;
};

export type Candidate = {
  id: string;
  resume_id: string;
  full_name: string;
  current_title: string;
  total_years_experience?: number | null;
  status: "new" | "reviewing" | "shortlisted" | "rejected" | "saved" | "hired" | "withdrawn";
  resume_status: string;
  filename: string;
  skills: string[];
  created_at: string;
};

export type UploadItem = {
  resume_id?: string;
  candidate_id?: string;
  filename: string;
  status: "ready" | "duplicate" | "failed";
  full_name?: string;
  current_title?: string;
  skills?: string[];
  error?: string;
};

export type UploadResponse = {
  items: UploadItem[];
  accepted: number;
  failed: number;
};

export type RankingRun = {
  id: string;
  job_id: string;
  job_version_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  model_version: string;
  feature_schema_version: string;
  candidate_count: number;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  results?: RankingResult[];
};

export type RequirementScore = {
  requirement_key: string;
  status: "met" | "partially_met" | "not_found" | "not_met" | "unknown";
  score: number;
  confidence: number;
  evidence_ids: string[];
};

export type RankingCandidateSummary = {
  id: string;
  resume_id: string;
  full_name: string;
  current_title: string;
  total_years_experience?: number | null;
  status: Candidate["status"];
  filename: string;
};

export type RankingResult = {
  id: string;
  ranking_run_id: string;
  candidate: RankingCandidateSummary;
  rank: number;
  final_score: number;
  confidence: number;
  eligibility_status: "eligible" | "potentially_eligible" | "constraint_unknown" | "constraint_failed";
  strengths: string[];
  gaps: string[];
  unknowns: string[];
  requirement_scores: RequirementScore[];
};
