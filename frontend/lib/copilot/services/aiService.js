const API_BASE_URL = 'http://localhost:3001/api/ai';

/**
 * Helper to call Backend API
 */
async function callBackend(endpoint, payload, apiKey) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey && apiKey.trim() !== '') {
      headers['x-gemini-api-key'] = apiKey.trim();
    }

    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.success) {
      throw new Error(result.error || `HTTP ${response.status}: Lỗi từ máy chủ Backend.`);
    }

    return result.data;
  } catch (error) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error("❌ [Lỗi Kết Nối Backend]: Không thể kết nối đến máy chủ BE tại port 3001. Vui lòng đảm bảo bạn đã chạy lệnh khởi động Backend ('cd BE && npm run dev').");
    }
    throw error;
  }
}

/**
 * Generate starter / icebreaker questions for Step 0 (calls BE /starter-questions)
 */
export async function generateStarterQuestions(apiKey, domainContext = 'Software Engineer', levelContext = 'Senior', angle = 'standard') {
  return await callBackend('starter-questions', {
    domainContext,
    levelContext,
    angle
  }, apiKey);
}

/**
 * Generate real-time deep-dive questions based on transcript history (calls BE /deep-dive)
 */
export async function generateDeepDiveQuestions(apiKey, transcriptHistory, lastCandidateAnswer, domainContext = 'Software Engineer', levelContext = 'Senior', angle = 'standard') {
  return await callBackend('deep-dive', {
    transcriptHistory,
    lastCandidateAnswer,
    domainContext,
    levelContext,
    angle
  }, apiKey);
}

/**
 * Evaluate a single turn answer (calls BE /evaluate)
 */
export async function evaluateAnswer(apiKey, question, answer, domainContext = 'Software Engineer', levelContext = 'Senior') {
  return await callBackend('evaluate', {
    question,
    answer,
    domainContext,
    levelContext
  }, apiKey);
}

/**
 * Generate final comprehensive after-interview evaluation report (calls BE /final-evaluation)
 */
export async function generateFinalEvaluation(apiKey, transcriptHistory, domainContext = 'Software Engineer', levelContext = 'Senior', turnEvaluations = []) {
  return await callBackend('final-evaluation', {
    transcriptHistory,
    domainContext,
    levelContext,
    turnEvaluations
  }, apiKey);
}

/**
 * Classify speaker role (interviewer vs candidate) using BE lite model
 */
export async function classifySpeaker(apiKey, text, recentHistory = []) {
  return await callBackend('classify-speaker', {
    text,
    recentHistory
  }, apiKey);
}

