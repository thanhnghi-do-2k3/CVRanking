import { NextResponse } from "next/server";

export const runtime = "nodejs";

type AssistantTurn = {
  role: "user" | "model";
  text: string;
};

type AssistantRequest = {
  thread_id?: string;
  title?: string;
  jd?: string;
  message?: string;
};

type AssistantResult = {
  reply: string;
  revised_jd: string;
};

type GeminiResponse = {
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

declare global {
  var jdAssistantThreads: Map<string, AssistantTurn[]> | undefined;
  var geminiKeyCursor: number | undefined;
}

function threads() {
  globalThis.jdAssistantThreads ??= new Map();
  return globalThis.jdAssistantThreads;
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

function clampHistory(history: AssistantTurn[]) {
  return history.slice(-8);
}

function normalizeJD(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const heading = /^(about the role|key responsibilities|responsibilities|requirements|nice to have)$/i.test(
        line.replace(/:$/, ""),
      );
      if (heading) {
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
}

function localFallback(title: string, jd: string, message: string): AssistantResult {
  const lower = message.toLowerCase();
  let revised = normalizeJD(jd);

  if (lower.includes("tiếng việt") || lower.includes("vietnamese")) {
    revised = revised
      .replace("About the role", "Tổng quan vai trò")
      .replace("Key responsibilities", "Trách nhiệm chính")
      .replace("Requirements", "Yêu cầu")
      .replace("Nice to have", "Điểm cộng")
      .replace(/We are hiring a ([^\n]+?) to /, "Chúng tôi đang tuyển $1 để ");
  }

  if (lower.includes("rút gọn") || lower.includes("ngắn")) {
    const lines = revised.split(/\r?\n/);
    revised = lines
      .filter((line, index) => index < 2 || /^(About|Key|Requirements|Nice|Tổng|Trách|Yêu|Điểm|-)/.test(line))
      .slice(0, 14)
      .join("\n")
      .trim();
  }

  if (lower.includes("ranking") || lower.includes("rõ tiêu chí") || lower.includes("tiêu chí")) {
    revised = normalizeJD(`${revised}

Ranking signals
- Prioritize candidates with direct evidence for must-have skills and production ownership.
- Prefer CVs that state years of experience, business impact and concrete technology scope.
- Treat nice-to-have items as differentiators, not hard filters.`);
  }

  if (lower.includes("kubernetes") && !/kubernetes/i.test(revised)) {
    revised = normalizeJD(`${revised}

Nice to have
- Kubernetes experience operating multi-service platforms.`);
  }

  return {
    reply: "Mình đã chỉnh JD theo yêu cầu bằng fallback local. Khi cấu hình GEMINI_API_KEYS, phần này sẽ dùng Gemini và ghi nhớ ngữ cảnh tốt hơn.",
    revised_jd: revised || `About the role\nWe are hiring a ${title}.\n\nRequirements\n- Relevant production experience.`,
  };
}

function extractJSON(text: string): AssistantResult {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(jsonText) as Partial<AssistantResult>;
  if (!parsed.revised_jd || !parsed.reply) {
    throw new Error("Gemini response missing required fields.");
  }
  return {
    reply: String(parsed.reply).trim(),
    revised_jd: normalizeJD(String(parsed.revised_jd)),
  };
}

function assistantSystemPrompt() {
  return [
    "You are an HR job-description editing assistant for a CV ranking product.",
    "Rewrite the current JD according to the user's instruction while preserving truthful scope.",
    "Keep the JD structured with headings: About the role, Key responsibilities, Requirements, Nice to have.",
    "Make requirements explicit and parse-friendly for CV ranking. Do not invent extreme requirements unless asked.",
    "Return strict JSON only with keys: reply, revised_jd.",
  ].join("\n");
}

async function callGemini(title: string, jd: string, message: string, history: AssistantTurn[]) {
  const keys = geminiKeys();
  if (keys.length === 0) {
    return null;
  }

  const model = geminiModelName();
  const systemPrompt = assistantSystemPrompt();

  const contents = [
    ...clampHistory(history).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    {
      role: "user",
      parts: [
        {
          text: JSON.stringify(
            {
              current_title: title,
              current_jd: jd,
              instruction: message,
            },
            null,
            2,
          ),
        },
      ],
    },
  ];

  const start = globalThis.geminiKeyCursor ?? 0;
  let lastError = "";

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const keyIndex = (start + attempt) % keys.length;
    const key = keys[keyIndex];
    globalThis.geminiKeyCursor = (keyIndex + 1) % keys.length;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.25,
            responseMimeType: "application/json",
          },
        }),
      });

      const payload = (await response.json()) as GeminiResponse;
      if (!response.ok) {
        lastError = payload.error?.message || `Gemini HTTP ${response.status}`;
        continue;
      }

      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
      if (!text) {
        lastError = "Gemini returned an empty response.";
        continue;
      }

      return {
        ...extractJSON(text),
        provider: "gemini",
        model,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Gemini request failed.";
    }
  }

  console.warn("gemini_jd_assistant_fallback", lastError || "All Gemini keys failed.");
  return null;
}

async function callGroq(title: string, jd: string, message: string, history: AssistantTurn[]) {
  const key = groqKey();
  if (!key) {
    return null;
  }

  const model = groqModelName();
  const messages = [
    { role: "system", content: assistantSystemPrompt() },
    ...clampHistory(history).map((turn) => ({
      role: turn.role === "model" ? "assistant" : "user",
      content: turn.text,
    })),
    {
      role: "user",
      content: JSON.stringify(
        {
          current_title: title,
          current_jd: jd,
          instruction: message,
        },
        null,
        2,
      ),
    },
  ];

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.25,
        response_format: { type: "json_object" },
      }),
    });

    const payload = (await response.json()) as OpenAIChatResponse;
    if (!response.ok) {
      console.warn("groq_jd_assistant_fallback", payload.error?.message || `Groq HTTP ${response.status}`);
      return null;
    }

    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.warn("groq_jd_assistant_fallback", "Groq returned an empty response.");
      return null;
    }

    return {
      ...extractJSON(text),
      provider: "groq",
      model,
    };
  } catch (error) {
    console.warn("groq_jd_assistant_fallback", error instanceof Error ? error.message : "Groq request failed.");
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AssistantRequest;
    const title = String(body.title ?? "Untitled role").trim() || "Untitled role";
    const jd = String(body.jd ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (jd.length < 20) {
      return NextResponse.json({ detail: "JD cần ít nhất 20 ký tự." }, { status: 422 });
    }
    if (message.length < 2) {
      return NextResponse.json({ detail: "Nhập yêu cầu bạn muốn AI chỉnh JD." }, { status: 422 });
    }

    const threadID = body.thread_id || crypto.randomUUID();
    const history = threads().get(threadID) ?? [];
    const result = (await callGemini(title, jd, message, history)) ?? (await callGroq(title, jd, message, history)) ?? {
      ...localFallback(title, jd, message),
      provider: "local_fallback",
      model: "local-jd-rules-v1",
    };

    const nextHistory: AssistantTurn[] = [
      ...history,
      { role: "user" as const, text: message },
      { role: "model" as const, text: result.reply },
    ].slice(-12);
    threads().set(threadID, nextHistory);

    return NextResponse.json({
      thread_id: threadID,
      ...result,
      turns: nextHistory.length,
      gemini_configured: geminiKeys().length > 0,
      groq_configured: Boolean(groqKey()),
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Không thể chạy JD assistant." },
      { status: 500 },
    );
  }
}
