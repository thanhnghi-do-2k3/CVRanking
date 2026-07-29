// TEMPORARY PLACEHOLDER — frontend/app/interviewer/page.tsx and
// frontend/components/copilot/settings-center.tsx (from feat/huyluu/audio) import
// PRESET_DOMAINS/PRESET_LEVELS from this path, but the file was never pushed with that
// branch. This stub only exists so the app builds; replace it with the real preset data
// from that feature's author.

export const PRESET_LEVELS = [
  { id: "Intern", label: "Intern / Fresher" },
  { id: "Junior", label: "Junior Engineer" },
  { id: "Mid", label: "Mid-level Engineer" },
  { id: "Senior", label: "Senior Engineer / Lead" },
];

export const PRESET_DOMAINS = [
  { id: "frontend", title: "Frontend Engineer (React & Performance)", icon: "🖥️" },
  { id: "backend", title: "Backend Engineer (APIs & Databases)", icon: "🛠️" },
  { id: "fullstack", title: "Full-stack Engineer", icon: "🧩" },
  { id: "data", title: "Data Engineer / Data Scientist", icon: "📊" },
  { id: "devops", title: "DevOps / Site Reliability Engineer", icon: "☁️" },
  { id: "mobile", title: "Mobile Engineer (iOS/Android)", icon: "📱" },
];
