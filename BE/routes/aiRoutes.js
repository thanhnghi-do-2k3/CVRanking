import express from 'express';
import { 
  generateStarterQuestions, 
  generateDeepDiveQuestions, 
  evaluateAnswer, 
  generateFinalEvaluation,
  classifySpeaker
} from '../services/aiEngine.js';

const router = express.Router();

// Helper to extract API key from header or body
const getApiKey = (req) => {
  return req.headers['x-gemini-api-key'] || req.body.apiKey || '';
};

// 1. Generate starter questions
router.post('/starter-questions', async (req, res) => {
  try {
    const { domainContext, levelContext, angle } = req.body;
    const apiKey = getApiKey(req);
    const questions = await generateStarterQuestions(apiKey, domainContext, levelContext, angle);
    res.json({ success: true, data: questions });
  } catch (error) {
    console.error("BE [/starter-questions] error:", error.message);
    res.status(500).json({ success: false, error: error.message || "Lỗi tạo câu hỏi khởi động từ Backend" });
  }
});

// 2. Generate deep-dive follow up questions
router.post('/deep-dive', async (req, res) => {
  try {
    const { transcriptHistory, lastCandidateAnswer, domainContext, levelContext, angle } = req.body;
    const apiKey = getApiKey(req);
    const questions = await generateDeepDiveQuestions(apiKey, transcriptHistory, lastCandidateAnswer, domainContext, levelContext, angle);
    res.json({ success: true, data: questions });
  } catch (error) {
    console.error("BE [/deep-dive] error:", error.message);
    res.status(500).json({ success: false, error: error.message || "Lỗi tạo câu hỏi đào sâu từ Backend" });
  }
});

// 3. Evaluate a single answer
router.post('/evaluate', async (req, res) => {
  try {
    const { question, answer, domainContext, levelContext } = req.body;
    const apiKey = getApiKey(req);
    const evaluation = await evaluateAnswer(apiKey, question, answer, domainContext, levelContext);
    res.json({ success: true, data: evaluation });
  } catch (error) {
    console.error("BE [/evaluate] error:", error.message);
    res.status(500).json({ success: false, error: error.message || "Lỗi chấm điểm câu trả lời từ Backend" });
  }
});

// 4. Generate final comprehensive report
router.post('/final-evaluation', async (req, res) => {
  try {
    const { transcriptHistory, domainContext, levelContext, turnEvaluations } = req.body;
    const apiKey = getApiKey(req);
    const report = await generateFinalEvaluation(apiKey, transcriptHistory, domainContext, levelContext, turnEvaluations);
    res.json({ success: true, data: report });
  } catch (error) {
    console.error("BE [/final-evaluation] error:", error.message);
    res.status(500).json({ success: false, error: error.message || "Lỗi tổng hợp báo cáo từ Backend" });
  }
});

// 5. Classify speaker role using lite model
router.post('/classify-speaker', async (req, res) => {
  try {
    const { text, recentHistory } = req.body;
    const apiKey = getApiKey(req);
    const result = await classifySpeaker(apiKey, text, recentHistory);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("BE [/classify-speaker] error:", error.message);
    res.status(500).json({ success: false, error: error.message || "Lỗi phân loại vai từ Backend" });
  }
});

export default router;
