import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || '';
const AI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
const LITE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

/**
 * Helper to call Gemini AI either via official @google/genai SDK or REST fetch fallback across multiple models
 */
async function callGemini(apiKey, prompt, temperature = 0.7, modelsList = AI_MODELS) {
  const activeKey = (apiKey && apiKey.trim() !== '') ? apiKey.trim() : DEFAULT_API_KEY;
  let lastError = null;

  for (const modelName of modelsList) {
    try {
      // Attempt 1: Official @google/genai SDK
      const ai = new GoogleGenAI({ apiKey: activeKey });
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: temperature,
          responseMimeType: 'application/json'
        }
      });
      const text = response.text || '';
      if (text.trim()) {
        const parsed = JSON.parse(text.trim());
        return parsed;
      }
    } catch {
      // If SDK fails, fallback to REST fetch below for this model
    }

    // Attempt 2: REST fetch fallback for this model
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            responseMimeType: "application/json"
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        if (resultText.trim()) {
          return JSON.parse(resultText);
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error?.message || `HTTP Status ${response.status}`;
        lastError = new Error(`[Model ${modelName}] ${errMsg}`);
      }
    } catch (fetchErr) {
      lastError = fetchErr;
    }
  }

  throw lastError || new Error("Không thể kết nối đến máy chủ Gemini AI từ Backend. Vui lòng kiểm tra lại API Key hoặc đường truyền.");
}

/**
 * Generate starter / icebreaker questions for Step 0
 */
export async function generateStarterQuestions(apiKey, domainContext = 'Software Engineer', levelContext = 'Senior', angle = 'standard') {
  const activeKey = (apiKey && apiKey.trim() !== '') ? apiKey : DEFAULT_API_KEY;

  let anglePrompt = "Hỏi về các câu hỏi cốt lõi để bắt đầu đánh giá năng lực toàn diện (Icebreaker -> Technical core -> Problem solving).";
  if (angle === 'architecture') anglePrompt = "Tập trung 100% vào tư duy thiết kế hệ thống, mở rộng quy mô (System Design & Scalability) và các trade-off kỹ thuật.";
  if (angle === 'troubleshooting') anglePrompt = "Tập trung vào kinh nghiệm xử lý sự cố thực tế (Incident response, Debugging production, Performance bottleneck).";
  if (angle === 'leadership') anglePrompt = "Tập trung vào kỹ năng làm việc nhóm, giải quyết xung đột kỹ thuật, định hướng công nghệ và hướng dẫn (Mentorship).";

  const prompt = `Bạn là Chủ tịch Hội đồng phỏng vấn kỹ thuật cấp cao cho vị trí: "${levelContext} ${domainContext}".
Người phỏng vấn đang cần danh sách các câu hỏi chất lượng cao để hỏi ứng viên.
Yêu cầu góc độ hỏi: ${anglePrompt}

Hãy gợi ý ĐÚNG 3 câu hỏi sắc bén nhất, được thiết kế chuyên biệt cho ${levelContext} ${domainContext}:
- Câu 1: Kiểm tra nền tảng hoặc kinh nghiệm thực tế nổi bật nhất trong chuyên ngành.
- Câu 2: Một câu hỏi tình huống thực tế (Scenario-based question) thử thách khả năng suy luận logic.
- Câu 3: Khai thác tư duy sâu (Deep-dive / trade-offs / bài học rút ra từ sai lầm).

Hãy trả về duy nhất 1 JSON Array chứa đúng 3 chuỗi câu hỏi (chỉ JSON Array, không markdown text ngoài JSON). Ví dụ:
["Câu hỏi 1...", "Câu hỏi 2...", "Câu hỏi 3..."]`;

  const parsed = await callGemini(activeKey, prompt, 0.7);
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.slice(0, 3);
  }
  throw new Error("Dữ liệu AI trả về từ Backend không đúng định dạng JSON Array mong đợi.");
}

/**
 * Generate real-time deep-dive questions based on transcript history
 */
export async function generateDeepDiveQuestions(apiKey, transcriptHistory, lastCandidateAnswer, domainContext = 'Software Engineer', levelContext = 'Senior', angle = 'standard') {
  const activeKey = (apiKey && apiKey.trim() !== '') ? apiKey : DEFAULT_API_KEY;
  
  if (!lastCandidateAnswer || lastCandidateAnswer.trim() === '') {
    return generateStarterQuestions(apiKey, domainContext, levelContext, angle);
  }

  let angleInstruction = "Khám phá sâu hơn vào nguyên lý kỹ thuật, tình huống tải cao và tư duy đánh đổi.";
  if (angle === 'architecture') angleInstruction = "Lái cuộc trò chuyện sang hướng thiết kế hệ thống tổng thể, kiến trúc microservices/cloud và khả năng mở rộng gấp 100 lần.";
  if (angle === 'troubleshooting') angleInstruction = "Lái sang các tình huống lỗi thực tế: Memory leak, Race condition, Security vulnerabilities, Network timeout hoặc sự cố database.";
  if (angle === 'leadership') angleInstruction = "Lái sang hướng quản lý kỹ thuật, làm việc với Product/Biz team, ước tính chi phí cloud (Cost optimization) và ra quyết định.";

  const prompt = `Bạn là một chuyên gia phỏng vấn kỹ thuật cấp cao (Principal / Lead Interviewer) đang phỏng vấn ứng viên cho vị trí: "${levelContext} ${domainContext}".

Dưới đây là lịch sử hội thoại phỏng vấn gần nhất:
${(transcriptHistory || []).map(t => `${t.speaker === 'interviewer' ? 'Người phỏng vấn' : 'Ứng viên'}: ${t.text}`).join('\n')}

Câu trả lời vừa rồi của ứng viên: "${lastCandidateAnswer}"

Nhiệm vụ của bạn: Hãy dựa trên ngữ cảnh chuyên ngành "${domainContext}" và cấp độ "${levelContext}", phân tích sâu câu trả lời của ứng viên và gợi ý ĐÚNG 3 câu hỏi tiếp theo (Deep-dive follow-up questions) cực kỳ sắc bén cho người phỏng vấn.
Góc độ chỉ đạo: ${angleInstruction}
- Câu hỏi số 1: Khai thác sâu về nguyên lý bên trong (under the hood / core mechanism) của công nghệ ứng viên vừa nhắc đến.
- Câu hỏi số 2: Đưa ra tình huống biên (edge case / scale 100x / high load / security bottleneck) thách thức giải pháp của ứng viên.
- Câu hỏi số 3: Hỏi về tư duy đánh đổi (trade-offs), tại sao không dùng phương án tiêu chuẩn khác hoặc bài học rút ra.

Hãy trả về duy nhất 1 JSON Array chứa đúng 3 chuỗi câu hỏi (chỉ JSON Array, không markdown text ngoài JSON). Ví dụ:
["Câu hỏi 1...", "Câu hỏi 2...", "Câu hỏi 3..."]`;

  const parsed = await callGemini(activeKey, prompt, 0.7);
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.slice(0, 3);
  }
  throw new Error("Dữ liệu câu hỏi deep-dive từ Backend trả về không đúng định dạng mảng.");
}

/**
 * Evaluate a single turn answer
 */
export async function evaluateAnswer(apiKey, question, answer, domainContext = 'Software Engineer', levelContext = 'Senior') {
  const activeKey = (apiKey && apiKey.trim() !== '') ? apiKey : DEFAULT_API_KEY;

  if (!answer || answer.trim() === '') {
    return {
      score: 0,
      verdict: 'Chưa có câu trả lời từ ứng viên',
      strengths: [],
      weaknesses: ['Ứng viên chưa đưa ra câu trả lời chi tiết cho câu hỏi này.'],
      followUpTopic: 'Yêu cầu ứng viên trình bày chi tiết hơn.'
    };
  }

  const prompt = `Bạn là một hội đồng giám khảo phỏng vấn kỹ thuật cực kỳ nghiêm ngặt và sâu sắc cho vị trí "${levelContext} ${domainContext}".
Hãy đánh giá câu trả lời sau đây của ứng viên:

Câu hỏi của giám khảo: "${question}"
Câu trả lời của ứng viên: "${answer}"

Hãy phân tích dựa trên tiêu chuẩn năng lực của một ${levelContext} ${domainContext} và trả về ĐÚNG 1 đối tượng JSON duy nhất (không có bất kỳ markdown hay text nào ngoài JSON) với cấu trúc:
{
  "score": số từ 1.0 đến 10.0 (thang điểm 10, hãy chấm chính xác dựa trên độ sâu kỹ thuật, ví dụ 8.5, 9.0, 7.2),
  "verdict": "Một câu nhận xét tóm tắt cực kỳ chuyên nghiệp (dưới 12 từ) về chất lượng câu trả lời",
  "strengths": ["Điểm mạnh 1 về tư duy/kỹ thuật", "Điểm mạnh 2 (ví dụ nêu được số liệu thực tế)"],
  "weaknesses": ["Điểm thiếu sót 1 hoặc lỗ hổng trong giải pháp", "Điểm thiếu sót 2 (nếu có)"],
  "followUpTopic": "Chủ đề kỹ thuật cụ thể cần hỏi tiếp theo để kiểm tra sâu hơn"
}`;

  const parsed = await callGemini(activeKey, prompt, 0.5);
  return {
    score: typeof parsed.score === 'number' ? parsed.score : 8.5,
    verdict: parsed.verdict || 'Trả lời có logic và kiến thức chuyên môn tốt',
    strengths: Array.isArray(parsed.strengths) && parsed.strengths.length > 0 ? parsed.strengths : ['Trình bày vấn đề mạch lạc, hiểu trọng tâm câu hỏi.'],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
    followUpTopic: parsed.followUpTopic || `Khám phá sâu hơn về tối ưu hóa quy mô và kiến trúc ${domainContext}.`
  };
}

/**
 * Generate final comprehensive after-interview evaluation report
 */
export async function generateFinalEvaluation(apiKey, transcriptHistory, domainContext = 'Software Engineer', levelContext = 'Senior', _turnEvaluations = []) {
  const activeKey = (apiKey && apiKey.trim() !== '') ? apiKey : DEFAULT_API_KEY;

  if (!transcriptHistory || transcriptHistory.length === 0) {
    return {
      overallScore: 0,
      verdictTitle: '❌ CHƯA CÓ DỮ LIỆU PHỎNG VẤN',
      verdictColor: 'text-slate-400 bg-slate-800 border-slate-700',
      summaryText: 'Chưa diễn ra lượt thoại nào để đánh giá ứng viên.',
      skills: [
        { name: 'Khả năng chuyên môn sâu (Technical Mastery)', score: 0 },
        { name: 'Tư duy xử lý tình huống (Problem Solving)', score: 0 },
        { name: 'Giao tiếp & Trình bày mạch lạc (Communication)', score: 0 },
        { name: 'Tư duy kiến trúc hệ thống (System Scalability)', score: 0 }
      ],
      keyStrengths: [],
      redFlags: ['Không có dữ liệu hội thoại.'],
      hiringAdvice: 'Hãy thực hiện phỏng vấn trước khi xuất báo cáo.'
    };
  }

  const prompt = `Bạn là Chủ tịch Hội đồng tuyển dụng kỹ thuật cấp cao (Chief Technology Officer / VP of Engineering).
Cuộc phỏng vấn cho vị trí "${levelContext} ${domainContext}" vừa kết thúc.
Dưới đây là toàn bộ biên bản hội thoại (Transcript):
${(transcriptHistory || []).map(t => `[${t.speaker === 'interviewer' ? '👔 Giám khảo' : '🧑‍💻 Ứng viên'}]: ${t.text}`).join('\n\n')}

Hãy phân tích tổng thể toàn bộ cuộc phỏng vấn và trả về ĐÚNG 1 đối tượng JSON duy nhất (không markdown ngoài JSON) với cấu trúc sau:
{
  "overallScore": điểm tổng kết từ 1.0 đến 10.0 (chính xác đến 1 chữ số thập phân),
  "verdictTitle": "Chọn 1 trong 4 chuẩn: '🌟 KHUYẾN NGHỊ TUYỂN DỤNG (STRONG HIRE)', '✅ TUYỂN DỤNG (HIRE)', '⚠️ CÂN NHẮC VÒNG SAU (LEAN HIRE)', hoặc '❌ KHÔNG ĐẠT (NO HIRE)'",
  "verdictColor": "text-emerald-400 bg-emerald-500/20 border-emerald-500/50" (nếu Strong Hire/Hire) hoặc "text-amber-300 bg-amber-500/20 border-amber-500/50" (nếu Lean Hire) hoặc "text-rose-400 bg-rose-500/20 border-rose-500/50" (nếu No Hire),
  "summaryText": "Đoạn văn nhận xét tổng quan 2-3 câu về trình độ thực tế, điểm sáng lớn nhất và mức độ phù hợp với văn hóa/công việc của ứng viên.",
  "skills": [
    { "name": "Khả năng chuyên môn sâu (Technical Mastery)", "score": điểm từ 1.0 đến 10.0 },
    { "name": "Tư duy xử lý tình huống (Problem Solving)", "score": điểm từ 1.0 đến 10.0 },
    { "name": "Giao tiếp & Trình bày mạch lạc (Communication)", "score": điểm từ 1.0 đến 10.0 },
    { "name": "Tư duy kiến trúc hệ thống (System Scalability)", "score": điểm từ 1.0 đến 10.0 }
  ],
  "keyStrengths": ["3-5 điểm mạnh nổi bật nhất rút ra từ các câu trả lời thực tế"],
  "redFlags": ["2-3 điểm rủi ro, lỗ hổng kiến thức hoặc cảnh báo cần chú ý khi tiếp nhận vào làm việc"],
  "hiringAdvice": "Lời khuyên đắt giá cho Hiring Manager về việc bố trí vị trí, mức lương hoặc chủ đề cần kiểm tra thêm ở vòng reference check."
}`;

  const parsed = await callGemini(activeKey, prompt, 0.4);
  return {
    overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 8.5,
    verdictTitle: parsed.verdictTitle || '✅ TUYỂN DỤNG (HIRE)',
    verdictColor: parsed.verdictColor || 'text-cyan-300 bg-cyan-500/20 border-cyan-500/50',
    summaryText: parsed.summaryText || 'Ứng viên có trình độ kỹ thuật tốt và tư duy mạch lạc.',
    skills: Array.isArray(parsed.skills) ? parsed.skills : [
      { name: 'Khả năng chuyên môn sâu (Technical Mastery)', score: 8.5 },
      { name: 'Tư duy xử lý tình huống (Problem Solving)', score: 8.0 },
      { name: 'Giao tiếp & Trình bày mạch lạc (Communication)', score: 9.0 },
      { name: 'Tư duy kiến trúc hệ thống (System Scalability)', score: 8.5 }
    ],
    keyStrengths: Array.isArray(parsed.keyStrengths) ? parsed.keyStrengths : ['Trình bày rõ ràng, nắm vững chuyên môn.'],
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : ['Không phát hiện rủi ro lớn.'],
    hiringAdvice: parsed.hiringAdvice || 'Có thể tiếp nhận vào đội ngũ phát triển sản phẩm trọng điểm.'
  };
}

/**
 * 5. Classify speaker role (interviewer vs candidate) using ultra-lightweight Lite model (low token cost)
 */
export async function classifySpeaker(apiKey, text, recentHistory = []) {
  const activeKey = (apiKey && apiKey.trim() !== '') ? apiKey.trim() : DEFAULT_API_KEY;
  const contextText = recentHistory.slice(-3).map(t => `${t.speaker === 'interviewer' ? 'Người phỏng vấn' : 'Ứng viên'}: "${t.text}"`).join('\n');
  
  const prompt = `Bạn là hệ thống AI phân loại vai người nói trong buổi phỏng vấn IT.
Lịch sử 3 câu gần nhất:
${contextText || '(Bắt đầu buổi phỏng vấn)'}

Câu nói mới cần xác định: "${text}"

Quy tắc:
- Nếu là câu hỏi, lời hỏi thăm, dẫn dắt, yêu cầu giải thích -> "interviewer"
- Nếu là lời trả lời kinh nghiệm, trình bày kỹ thuật, giải thích chi tiết -> "candidate"

Chỉ trả về JSON hợp lệ duy nhất:
{ "speaker": "interviewer" hoặc "candidate" }`;

  try {
    const parsed = await callGemini(activeKey, prompt, 0.1, LITE_MODELS);
    return {
      speaker: (parsed.speaker === 'candidate' || parsed.speaker === 'interviewer') ? parsed.speaker : 'interviewer'
    };
  } catch (error) {
    console.warn("AI classifySpeaker fallback due to:", error.message);
    // Default fallback based on question mark
    return {
      speaker: (text.includes('?') || text.toLowerCase().includes('tại sao') || text.toLowerCase().includes('hãy')) ? 'interviewer' : 'candidate'
    };
  }
}

