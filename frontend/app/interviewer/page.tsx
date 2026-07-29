"use client";

import React, { useState, useEffect } from 'react';
import { DemoShell } from '@/components/demo-shell';
import { Settings, CheckSquare, Sparkles } from 'lucide-react';
import { AudioVisualizer } from '@/components/copilot/audio-visualizer';
import { TranscriptPanel, type TranscriptItem } from '@/components/copilot/transcript-panel';
import { CopilotPanel } from '@/components/copilot/copilot-panel';
import { SettingsCenter } from '@/components/copilot/settings-center';
import { SummaryModal } from '@/components/copilot/summary-modal';

// @ts-ignore
import { PRESET_DOMAINS, PRESET_LEVELS } from '@/lib/copilot/data/jobPresets';
// @ts-ignore
import { speechService } from '@/lib/copilot/services/speechService';
// @ts-ignore
import { generateDeepDiveQuestions, evaluateAnswer, generateStarterQuestions, generateFinalEvaluation, classifySpeaker } from '@/lib/copilot/services/aiService';
// @ts-ignore
import { audioStreamer } from '@/lib/copilot/services/audioStreamer';
// @ts-ignore
import { liveApiService } from '@/lib/copilot/services/liveApiService';

const DEFAULT_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';

export default function InterviewerPage() {
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || DEFAULT_API_KEY;
    }
    return DEFAULT_API_KEY;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('domain');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  
  const [language, setLanguage] = useState('vi-VN');
  const [isListening, setIsListening] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<'interviewer' | 'candidate'>('interviewer');
  const [autoDetectSpeaker, setAutoDetectSpeaker] = useState(true);
  
  const [jobDomain, setJobDomain] = useState(() => PRESET_DOMAINS[0]?.title || 'Frontend Engineer (React & Performance)');
  const [jobLevel, setJobLevel] = useState(() => PRESET_LEVELS[2]?.label || 'Senior Engineer / Lead');
  
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [interimText, setInterimText] = useState('');
  
  const [activeCopilotTab, setActiveCopilotTab] = useState<'questions' | 'evaluation' | 'live'>('questions');
  const [questions, setQuestions] = useState<string[]>([]);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [currentEvaluation, setCurrentEvaluation] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [liveText, setLiveText] = useState('');

  const [aiError, setAiError] = useState<string | null>(null);
  const [finalReport, setFinalReport] = useState<any>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== 'undefined' && !localStorage.getItem('gemini_api_key')) {
      localStorage.setItem('gemini_api_key', DEFAULT_API_KEY);
    }
  }, []);

  useEffect(() => {
    return () => {
      speechService.stopListening();
      audioStreamer.stop();
      liveApiService.disconnect();
    };
  }, []);

  const handleOpenSettings = (tab = 'domain') => {
    setActiveSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const handleSaveKey = (key: string) => {
    const finalKey = key || DEFAULT_API_KEY;
    setApiKey(finalKey);
    localStorage.setItem('gemini_api_key', finalKey);
    setAiError(null);
  };

  const handleToggleLanguage = () => {
    const nextLang = language === 'vi-VN' ? 'en-US' : 'vi-VN';
    setLanguage(nextLang);
    speechService.setLanguage(nextLang);
  };

  const handleToggleSpeaker = () => {
    const nextSpeaker = speechService.toggleSpeaker();
    setCurrentSpeaker(nextSpeaker);
  };

  const handleToggleListen = () => {
    if (isListening) {
      speechService.stopListening();
      audioStreamer.stop();
      liveApiService.disconnect();
      setIsListening(false);
      setInterimText('');
    } else {
      liveApiService.onText = (text: string) => {
        setLiveText(prev => prev + text);
        setActiveCopilotTab('live');
      };
      liveApiService.connect(apiKey, jobDomain, jobLevel);

      audioStreamer.start((base64PCM: string) => {
        liveApiService.sendAudioChunk(base64PCM);
      });

      const success = speechService.startListening(
        (data: any) => {
          if (data.interimTranscript) {
            setInterimText(data.interimTranscript);
          }
          if (data.finalTranscript) {
            let detectedSpeaker = data.speaker;
            const textLower = data.finalTranscript.toLowerCase().trim();

            const handleFinalInsert = (finalSpeaker: 'interviewer' | 'candidate') => {
              setInterimText('');
              const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
              const newItem: TranscriptItem = {
                speaker: finalSpeaker,
                text: data.finalTranscript,
                timestamp: timeStr
              };
              setTranscript(prev => {
                const updated = [...prev, newItem];
                
                if (finalSpeaker === 'candidate' || updated.length % 2 === 0) {
                  triggerAiAnalysis(updated, data.finalTranscript, 'standard');
                }
                return updated;
              });
              
              if (finalSpeaker === 'candidate') {
                speechService.setSpeaker('interviewer');
                setCurrentSpeaker('interviewer');
              } else if (autoDetectSpeaker && finalSpeaker === 'interviewer') {
                speechService.setSpeaker('candidate');
                setCurrentSpeaker('candidate');
              }
            };

            if (autoDetectSpeaker) {
              const isInterviewerQ = data.finalTranscript.includes('?') || 
                textLower.startsWith('tại sao') || textLower.startsWith('hãy') || 
                textLower.startsWith('em hãy') || textLower.startsWith('bạn có thể') ||
                textLower.startsWith('cho anh hỏi') || textLower.startsWith('chào em') ||
                textLower.startsWith('bạn hãy') || textLower.startsWith('giải thích');
                
              const isCandidateA = textLower.startsWith('dạ') || textLower.startsWith('theo em') || 
                textLower.startsWith('trong dự án') || textLower.startsWith('trước đây em') || 
                textLower.startsWith('cá nhân em') || textLower.startsWith('em nghĩ') ||
                textLower.startsWith('tôi nghĩ') || textLower.startsWith('kinh nghiệm');

              if (isInterviewerQ && !isCandidateA) {
                handleFinalInsert('interviewer');
              } else if (isCandidateA && !isInterviewerQ) {
                handleFinalInsert('candidate');
              } else {
                setInterimText(data.finalTranscript + ' ...');
                classifySpeaker(apiKey, data.finalTranscript, transcript).then((res: any) => {
                  if (res && res.speaker) {
                    handleFinalInsert(res.speaker);
                  } else {
                    handleFinalInsert(detectedSpeaker);
                  }
                }).catch(() => {
                  handleFinalInsert(detectedSpeaker);
                });
              }
            } else {
              handleFinalInsert(detectedSpeaker);
            }
          }
        },
        (err: any) => {
          console.error("Speech err:", err);
          setIsListening(false);
        },
        () => {
          setIsListening(false);
        }
      );
      if (success) {
        setIsListening(true);
      }
    }
  };

  const triggerAiAnalysis = async (currentTranscript = transcript, lastText = '', angle = 'standard') => {
    setIsAnalyzing(true);
    setAiError(null);
    try {
      if (currentTranscript.length === 0) {
        const qs = await generateStarterQuestions(apiKey, jobDomain, jobLevel, angle);
        setQuestions(qs);
        setActiveCopilotTab('questions');
      } else {
        const qs = await generateDeepDiveQuestions(apiKey, currentTranscript, lastText || currentTranscript[currentTranscript.length - 1]?.text, jobDomain, jobLevel, angle);
        setQuestions(qs);
        setActiveCopilotTab('questions');

        const lastCandidateItem = [...currentTranscript].reverse().find(t => t.speaker === 'candidate');
        const lastInterviewerItem = [...currentTranscript].reverse().find(t => t.speaker === 'interviewer');

        if (lastCandidateItem && angle === 'standard') {
          const ev = await evaluateAnswer(
            apiKey,
            lastInterviewerItem?.text || "Hãy trình bày chi tiết về kỹ năng và kinh nghiệm thực tế của bạn.",
            lastCandidateItem.text,
            jobDomain,
            jobLevel
          );
          setCurrentEvaluation(ev);
          setEvaluations(prev => [...prev, ev]);
        }
      }
    } catch (e: any) {
      console.error("AI Analysis error:", e);
      setAiError(e.message || "Lỗi khi suy luận AI. Vui lòng kiểm tra Quota hoặc khóa API Key.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddManualMessage = (text: string, speaker: string) => {
    let detectedSpeaker = speaker as 'interviewer' | 'candidate';
    if (speaker === 'auto' || (autoDetectSpeaker && speaker === 'auto')) {
      const textLower = text.toLowerCase().trim();
      const isInterviewerQ = text.includes('?') || 
        textLower.startsWith('tại sao') || textLower.startsWith('hãy') || 
        textLower.startsWith('em hãy') || textLower.startsWith('bạn có thể') ||
        textLower.startsWith('cho anh hỏi') || textLower.startsWith('chào em') ||
        textLower.startsWith('bạn hãy') || textLower.startsWith('giải thích');
        
      const isCandidateA = textLower.startsWith('dạ') || textLower.startsWith('theo em') || 
        textLower.startsWith('trong dự án') || textLower.startsWith('trước đây em') || 
        textLower.startsWith('cá nhân em') || textLower.startsWith('em nghĩ') ||
        textLower.startsWith('tôi nghĩ') || textLower.startsWith('kinh nghiệm');

      if (isInterviewerQ && !isCandidateA) {
        detectedSpeaker = 'interviewer';
      } else if (isCandidateA && !isInterviewerQ) {
        detectedSpeaker = 'candidate';
      } else {
        detectedSpeaker = currentSpeaker || 'interviewer';
        classifySpeaker(apiKey, text, transcript).then((res: any) => {
          if (res && res.speaker && res.speaker !== detectedSpeaker) {
            setTranscript(prev => prev.map((item, idx) => 
              idx === prev.length - 1 ? { ...item, speaker: res.speaker as 'interviewer' | 'candidate' } : item
            ));
            const nextSpk = res.speaker === 'candidate' ? 'interviewer' : 'candidate';
            speechService.setSpeaker(nextSpk);
            setCurrentSpeaker(nextSpk);
          }
        }).catch(() => {});
      }
    }

    const newItem: TranscriptItem = {
      speaker: detectedSpeaker,
      text,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };
    const updated = [...transcript, newItem];
    setTranscript(updated);
    
    if (detectedSpeaker === 'candidate' || updated.length % 2 === 0) {
      triggerAiAnalysis(updated, text, 'standard');
    }
    
    if (detectedSpeaker === 'candidate') {
      speechService.setSpeaker('interviewer');
      setCurrentSpeaker('interviewer');
    } else if (autoDetectSpeaker && detectedSpeaker === 'interviewer') {
      speechService.setSpeaker('candidate');
      setCurrentSpeaker('candidate');
    }
  };

  const handleSelectQuestionToAsk = (qText: string) => {
    handleAddManualMessage(qText, 'interviewer');
    speechService.setSpeaker('candidate');
    setCurrentSpeaker('candidate');
    setActiveCopilotTab('evaluation');
  };

  const handleOpenSummaryAndEvaluate = async () => {
    setIsSummaryOpen(true);
    if (transcript.length > 0) {
      setIsGeneratingReport(true);
      setAiError(null);
      try {
        const rep = await generateFinalEvaluation(apiKey, transcript, jobDomain, jobLevel, evaluations);
        setFinalReport(rep);
      } catch (e: any) {
        console.error("Final eval error:", e);
        setAiError(e.message || "Lỗi tổng hợp báo cáo AI cuối cùng.");
      } finally {
        setIsGeneratingReport(false);
      }
    }
  };

  const handleResetInterview = () => {
    if (isListening) {
      speechService.stopListening();
      setIsListening(false);
    }
    setTranscript([]);
    setInterimText('');
    setQuestions([]);
    setEvaluations([]);
    setCurrentEvaluation(null);
    setFinalReport(null);
    setAiError(null);
    setIsSummaryOpen(false);
  };

  if (!isMounted) {
    return (
      <DemoShell active="interviewer">
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </DemoShell>
    );
  }

  return (
    <DemoShell active="interviewer">
      <div className="flex flex-col h-full overflow-hidden pb-4">
        
        <div className="flex items-center justify-between mb-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800">AI Interview Copilot</h2>
              <p className="text-xs text-gray-500">
                {jobLevel} {jobDomain} • {language === 'vi-VN' ? 'Tiếng Việt' : 'English'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleOpenSettings('domain')}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Cấu Hình
            </button>
            <button
              onClick={handleOpenSummaryAndEvaluate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              <CheckSquare className="w-4 h-4" />
              Kết Thúc & Đánh Giá
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0 overflow-hidden">
          {/* Left Column */}
          <div className="flex flex-col h-full min-h-0">
            <AudioVisualizer
              isListening={isListening}
              onToggleListen={handleToggleListen}
              currentSpeaker={currentSpeaker}
              onToggleSpeaker={handleToggleSpeaker}
              autoDetectSpeaker={autoDetectSpeaker}
              onToggleAutoDetect={() => setAutoDetectSpeaker(p => !p)}
              speechSupported={speechService.isSupported}
            />

            <div className="flex-1 min-h-0 relative">
              <TranscriptPanel
                transcript={transcript}
                interimText={interimText}
                currentSpeaker={currentSpeaker}
                onAddManualMessage={handleAddManualMessage}
                onClearTranscript={handleResetInterview}
                _isListening={isListening}
                autoDetectSpeaker={autoDetectSpeaker}
              />
            </div>
          </div>

          {/* Right Column */}
          <div className="flex flex-col h-full min-h-0 relative">
            <CopilotPanel
              activeTab={activeCopilotTab}
              onTabChange={setActiveCopilotTab}
              questions={questions}
              evaluation={currentEvaluation}
              isAnalyzing={isAnalyzing}
              aiError={aiError}
              onTriggerAnalysis={(angle = 'standard') => triggerAiAnalysis(transcript, transcript[transcript.length - 1]?.text, angle)}
              onSelectQuestionToAsk={handleSelectQuestionToAsk}
              onOpenSettings={() => handleOpenSettings('apikey')}
              hasTranscript={transcript.length > 0}
              _jobDomain={jobDomain}
              liveText={liveText}
            />
          </div>
        </div>
      </div>

      <SettingsCenter
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={activeSettingsTab}
        apiKey={apiKey}
        onSaveKey={handleSaveKey}
        jobDomain={jobDomain}
        onSelectDomain={setJobDomain}
        jobLevel={jobLevel}
        onSelectLevel={setJobLevel}
        language={language}
        onToggleLanguage={handleToggleLanguage}
        speechSupported={speechService.isSupported}
        currentSpeaker={currentSpeaker}
        onToggleSpeaker={handleToggleSpeaker}
      />

      <SummaryModal
        isOpen={isSummaryOpen}
        onClose={() => setIsSummaryOpen(false)}
        transcript={transcript}
        evaluations={evaluations}
        onResetInterview={handleResetInterview}
        finalReport={finalReport}
        isGeneratingReport={isGeneratingReport}
        aiError={aiError}
        onOpenSettings={() => handleOpenSettings('apikey')}
        jobDomain={jobDomain}
        jobLevel={jobLevel}
      />
    </DemoShell>
  );
}
