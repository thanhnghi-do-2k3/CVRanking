import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import aiRoutes from './routes/aiRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS and JSON parsing
app.use(cors({
  origin: '*', // Allow local frontend and network clients
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-gemini-api-key']
}));
app.use(express.json({ limit: '10mb' }));

// Health Check Endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    engine: 'Gemini 3.5 Live Backend (Express.js)',
    port: PORT
  });
});

// Mount AI routes
app.use('/api/ai', aiRoutes);

// Root greeting
app.get('/', (_req, res) => {
  res.send('🚀 AI Interviewer Copilot Backend Server is Running on port ' + PORT);
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`✨ Backend Express Server started at http://localhost:${PORT}`);
  console.log(`⚡ API Health check: http://localhost:${PORT}/api/health`);
  console.log(`======================================================\n`);
});
