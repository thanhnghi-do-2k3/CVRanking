#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
MAILPIT_BASE="${MAILPIT_BASE:-http://localhost:8025/api/v1}"
PASSWORD="${PASSWORD:-StrongPassw0rd!2026}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need curl
need jq
need python3

if ! curl -fsS "$API_BASE/readyz" >/dev/null; then
  echo "API is not ready. Start the stack first: docker compose up -d --build" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

email="ranking.smoke.$(date +%s).$RANDOM@example.test"
cookie_jar="$work_dir/cookies.txt"

python3 - "$work_dir" <<'PY'
import pathlib
import sys

out = pathlib.Path(sys.argv[1])

profiles = {
    "01-strong-backend.pdf": [
        "Alex Nguyen",
        "Senior Backend Engineer",
        "8 years experience building production backend services.",
        "Skills: Go, PostgreSQL, Docker, Redis, REST APIs, Kubernetes, AWS.",
        "Led Go microservices with PostgreSQL, Redis cache, Docker deployment and REST APIs.",
    ],
    "02-mid-backend.pdf": [
        "Binh Tran",
        "Backend Developer",
        "4 years experience in backend systems.",
        "Skills: Python, PostgreSQL, Docker, REST APIs, FastAPI.",
        "Built API services and reporting jobs with PostgreSQL and Docker.",
    ],
    "03-frontend.pdf": [
        "Chris Le",
        "Frontend Developer",
        "3 years experience building web interfaces.",
        "Skills: React, TypeScript, CSS, Figma.",
        "Built dashboards and design systems for customer portals.",
    ],
}


def escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_pdf(path: pathlib.Path, lines: list[str]) -> None:
    text_ops = ["BT", "/F1 12 Tf", "72 760 Td", "15 TL"]
    for index, line in enumerate(lines):
        prefix = "" if index == 0 else "T* "
        text_ops.append(f"{prefix}({escape_pdf_text(line)}) Tj")
    text_ops.append("ET")
    stream = "\n".join(text_ops)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream.encode())} >>\nstream\n{stream}\nendstream",
    ]
    pdf = "%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf.encode()))
        pdf += f"{index} 0 obj\n{obj}\nendobj\n"
    xref = len(pdf.encode())
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    path.write_bytes(pdf.encode())


for filename, lines in profiles.items():
    write_pdf(out / filename, lines)
PY

echo "1. Registering smoke user: $email"
curl -fsS \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "$email" --arg password "$PASSWORD" \
    '{email:$email,password:$password,display_name:"Ranking Smoke Tester",workspace_name:"Ranking Smoke Workspace"}')" \
  "$API_BASE/auth/register" >/dev/null

message_id=""
for _ in $(seq 1 20); do
  message_id="$(
    curl -fsS "$MAILPIT_BASE/messages?limit=100" |
      jq -r --arg email "$email" '.messages[] | select(.To[]?.Address == $email) | .ID' |
      head -n 1
  )"
  if [ -n "$message_id" ]; then
    break
  fi
  sleep 1
done

if [ -z "$message_id" ]; then
  echo "Verification email was not found in Mailpit." >&2
  exit 1
fi

token="$(
  curl -fsS "$MAILPIT_BASE/message/$message_id" |
    jq -r '.HTML' |
    python3 -c 'import re,sys; html=sys.stdin.read(); match=re.search(r"verify-email#token=([^\"<]+)", html); print(match.group(1) if match else "")'
)"

if [ -z "$token" ]; then
  echo "Verification token was not found in the Mailpit message." >&2
  exit 1
fi

echo "2. Verifying email and opening session"
verify_response="$(
  curl -fsS -c "$cookie_jar" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg token "$token" '{token:$token}')" \
    "$API_BASE/auth/verify-email"
)"
access_token="$(jq -r '.access_token' <<<"$verify_response")"

echo "3. Creating JD"
job_response="$(
  curl -fsS \
    -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    -d "$(jq -n '{
      title:"Senior Backend Engineer",
      location:"Remote",
      employment_type:"full_time",
      description:"We need a senior backend engineer with Go, PostgreSQL, Docker, Redis and REST API experience. Kubernetes and AWS are nice to have. Minimum 5 years building production services."
    }')" \
    "$API_BASE/jobs"
)"
job_id="$(jq -r '.id' <<<"$job_response")"

echo "4. Uploading CV test set"
upload_response="$(
  curl -fsS \
    -H "Authorization: Bearer $access_token" \
    -F "job_id=$job_id" \
    -F "files=@$work_dir/01-strong-backend.pdf;type=application/pdf" \
    -F "files=@$work_dir/02-mid-backend.pdf;type=application/pdf" \
    -F "files=@$work_dir/03-frontend.pdf;type=application/pdf" \
    "$API_BASE/resumes/bulk-upload"
)"

echo "5. Running ranking"
ranking_response="$(
  curl -fsS \
    -H "Authorization: Bearer $access_token" \
    -X POST \
    "$API_BASE/jobs/$job_id/ranking-runs"
)"

echo
echo "Upload summary:"
jq '{accepted, failed, files: [.items[] | {filename, status, skills: (.skills // [])}]}' <<<"$upload_response"

echo
echo "Ranking result:"
jq -r '
  .results[]
  | [
      ("#" + (.rank|tostring)),
      ((.final_score * 100)|round|tostring + "%"),
      .candidate.full_name,
      (.strengths[0] // "No strength"),
      (.gaps[0] // "No gap")
    ]
  | @tsv
' <<<"$ranking_response" |
  awk 'BEGIN { FS="\t"; printf "%-5s %-7s %-18s %-70s %s\n", "Rank", "Score", "Candidate", "Top strength", "Top gap" }
       { printf "%-5s %-7s %-18s %-70s %s\n", $1, $2, $3, $4, $5 }'

echo
echo "Raw ranking run id: $(jq -r '.id' <<<"$ranking_response")"
echo "Job id: $job_id"
