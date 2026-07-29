import React, { useState } from 'react';
import { Sparkles, Award, Zap, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Send, BrainCircuit, Star, Flame, Lightbulb, Target, Layers, ShieldAlert, Users, Key } from 'lucide-react';

type Evaluation = {
  score?: number;
  verdict?: string;
  strengths?: string[];
  weaknesses?: string[];
  followUpTopic?: string;
};

type CopilotPanelProps = {
  activeTab: 'questions' | 'evaluation' | 'live';
  onTabChange: (tab: 'questions' | 'evaluation' | 'live') => void;
  questions: string[];
  evaluation: Evaluation | null;
  isAnalyzing: boolean;
  aiError: string | null;
  onTriggerAnalysis: (angle: string) => void;
  onSelectQuestionToAsk: (question: string) => void;
  onOpenSettings?: () => void;
  hasTranscript: boolean;
  _jobDomain: string;
  liveText: string;
};

export function CopilotPanel({
  activeTab,
  onTabChange,
  questions,
  evaluation,
  isAnalyzing,
  aiError,
  onTriggerAnalysis,
  onSelectQuestionToAsk,
  onOpenSettings,
  hasTranscript,
  _jobDomain,
  liveText
}: CopilotPanelProps) {
  const [activeAngle, setActiveAngle] = useState('standard');

  const getBadgeStyle = (idx: number, angle: string) => {
    if (angle === 'architecture') return { badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: <Layers className="w-3 h-3 text-purple-600" />, label: '📐 Kiến Trúc & Mở Rộng' };
    if (angle === 'troubleshooting') return { badge: 'bg-red-100 text-red-700 border-red-200', icon: <ShieldAlert className="w-3 h-3 text-red-600" />, label: '🐛 Xử Lý Lỗi & Production' };
    if (angle === 'leadership') return { badge: 'bg-orange-100 text-orange-700 border-orange-200', icon: <Users className="w-3 h-3 text-orange-600" />, label: '👔 Teamwork & Trade-offs' };

    switch(idx) {
      case 0: return { badge: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Flame className="w-3 h-3 text-blue-600" />, label: '🔬 Kỹ Thuật Sâu (Under The Hood)' };
      case 1: return { badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: <Target className="w-3 h-3 text-purple-600" />, label: '⚠️ Tải Cao & Tình Huống Biên' };
      case 2: return { badge: 'bg-orange-100 text-orange-700 border-orange-200', icon: <Lightbulb className="w-3 h-3 text-orange-600" />, label: '⚖️ Tư Duy Đổi Chác (Trade-offs)' };
      default: return { badge: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Zap className="w-3 h-3 text-blue-600" />, label: '💡 Câu Hỏi Đào Sâu' };
    }
  };

  const handleAngleChange = (angle: string) => {
    setActiveAngle(angle);
    onTriggerAnalysis(angle);
  };

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      
      {/* Header & Tabs */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <BrainCircuit className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-800 tracking-wide uppercase flex items-center gap-2">
                <span>AI Copilot Intelligence</span>
              </h2>
              <p className="text-xs text-gray-500">Không bao giờ bí câu hỏi • Chấm điểm AI chuẩn xác</p>
            </div>
          </div>

          <button
            onClick={() => onTriggerAnalysis(activeAngle)}
            disabled={isAnalyzing}
            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-md flex items-center gap-1.5 disabled:opacity-50 transition-colors border border-blue-200"
            title="Kích hoạt AI suy luận ra 3 câu hỏi mới lập tức"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
            <span>Đổi Bộ Hỏi Mới</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-gray-100 p-1 rounded-lg gap-1 border border-gray-200">
          <button
            onClick={() => onTabChange('questions')}
            className={`flex-1 text-center py-2 px-3 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'questions' ? 'bg-white text-blue-700 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Ngân hàng câu hỏi ({questions?.length || 0})</span>
          </button>
          <button
            onClick={() => onTabChange('evaluation')}
            className={`flex-1 text-center py-2 px-3 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'evaluation' ? 'bg-white text-purple-700 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Chấm điểm</span>
          </button>
          <button
            onClick={() => onTabChange('live')}
            className={`flex-1 text-center py-2 px-3 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'live' ? 'bg-white text-red-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Live Stream</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
        
        {/* Loading AI State */}
        {isAnalyzing ? (
          <div className="space-y-4 py-12 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-blue-50 border border-blue-100 mb-2">
              <Sparkles className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-gray-800">AI Đang Suy Luận...</h3>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                Đang tổng hợp các hướng hỏi sắc bén nhất theo chuyên ngành.
              </p>
            </div>
          </div>
        ) : aiError ? (
          /* Error Screen */
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-4 my-4">
            <div className="inline-flex p-3 rounded-xl bg-red-100 text-red-600 mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-red-800">LỖI KẾT NỐI GEMINI AI</h3>
              <p className="text-xs text-red-600 max-w-sm mx-auto">
                Hệ thống đã dừng chế độ dự phòng để xem chi tiết lỗi.
              </p>
            </div>
            
            <div className="bg-white p-3 rounded-lg border border-red-200 text-left overflow-x-auto text-xs text-red-700 font-mono">
              {aiError}
            </div>

            <div className="pt-2 flex justify-center gap-3">
              <button
                onClick={() => onTriggerAnalysis(activeAngle)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử Lại Ngay</span>
              </button>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-lg border border-gray-300 flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Kiểm Tra API Key</span>
                </button>
              )}
            </div>
          </div>
        ) : activeTab === 'questions' ? (
          /* TAB 1: QUESTIONS */
          <div className="space-y-5">
            {/* Angle Switcher */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 space-y-2 shadow-sm">
              <div className="flex items-center justify-between text-xs text-gray-500 font-semibold px-1">
                <span>🎯 Lái góc hỏi theo mục tiêu:</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'standard', label: 'Tiêu Chuẩn Sâu', color: 'blue' },
                  { id: 'architecture', label: 'Kiến Trúc/Scale', color: 'purple' },
                  { id: 'troubleshooting', label: 'Xử Lý Lỗi Live', color: 'red' },
                  { id: 'leadership', label: 'Trade-offs/Lead', color: 'orange' }
                ].map(angle => (
                  <button
                    key={angle.id}
                    type="button"
                    onClick={() => handleAngleChange(angle.id)}
                    disabled={isAnalyzing}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${
                      activeAngle === angle.id 
                        ? `bg-${angle.color}-50 text-${angle.color}-700 border-${angle.color}-200 shadow-sm` 
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {angle.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 pb-2 border-b border-gray-200">
              <span className="font-semibold">
                {!hasTranscript ? "3 Câu Hỏi Khởi Động" : "3 Câu Hỏi Đào Sâu Khuyến Nghị"}
              </span>
            </div>

            {(!questions || questions.length === 0) ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-xs text-gray-500">Chưa có câu hỏi nào trong bộ nhớ.</p>
                <button
                  onClick={() => onTriggerAnalysis('standard')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg"
                >
                  Khởi tạo câu hỏi mẫu
                </button>
              </div>
            ) : (
              questions.map((q, idx) => {
                const style = getBadgeStyle(idx, activeAngle);
                return (
                  <div 
                    key={idx}
                    className="bg-white p-5 rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group"
                    onClick={() => onSelectQuestionToAsk(q)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${style.badge}`}>
                        {style.icon}
                        {style.label}
                      </span>
                    </div>
                    
                    <p className="text-sm font-semibold text-gray-800 leading-relaxed group-hover:text-blue-900">
                      "{q}"
                    </p>

                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectQuestionToAsk(q);
                        }}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors border border-blue-200 hover:border-blue-600"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Hỏi Câu Này</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : activeTab === 'live' ? (
          /* TAB 3: LIVE STREAM */
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 h-[400px] overflow-y-auto">
              {!liveText ? (
                <div className="text-center py-12 space-y-3">
                  <Flame className="w-8 h-8 text-gray-300 mx-auto animate-pulse" />
                  <p className="text-xs text-gray-400 italic">Đang chờ tín hiệu từ AI Stream...</p>
                </div>
              ) : (
                <div className="text-sm text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">
                  {liveText}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* TAB 2: EVALUATION SCORECARD */
          <div className="space-y-5">
            {!evaluation ? (
              <div className="text-center py-12 space-y-3">
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
                  <Award className="w-6 h-6" />
                </div>
                <div className="max-w-xs mx-auto space-y-1">
                  <h4 className="text-sm font-bold text-gray-700">Chưa Chấm Điểm Lượt Này</h4>
                  <p className="text-xs text-gray-500">
                    Hãy chờ ứng viên trả lời hoặc nhấn "Đổi Bộ Hỏi Mới" để chấm điểm!
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-white p-6 rounded-xl border border-gray-200 flex flex-col sm:flex-row items-center gap-5 shadow-sm">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold bg-purple-50 text-purple-700 border-2 border-purple-200 shrink-0">
                    {evaluation.score || 8.5}
                  </div>
                  <div className="space-y-1.5 text-center sm:text-left flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-purple-600">
                        Chất Lượng Lượt Đáp
                      </span>
                      <div className="flex justify-center text-orange-400">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className={`w-3.5 h-3.5 ${(i < Math.round((evaluation.score || 8)/2)) ? 'fill-current' : 'text-gray-200'}`} />
                        ))}
                      </div>
                    </div>
                    <h3 className="text-sm font-bold text-gray-800 leading-snug">
                      "{evaluation.verdict || 'Trả lời khá tốt và mạch lạc'}"
                    </h3>
                  </div>
                </div>

                <div className="bg-green-50 p-5 rounded-xl border border-green-200 space-y-3">
                  <h4 className="text-xs font-bold text-green-700 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Điểm Mạnh
                  </h4>
                  <ul className="space-y-2">
                    {(evaluation.strengths || ['Trình bày rõ ràng, mạch lạc']).map((s, i) => (
                      <li key={i} className="text-sm font-medium text-green-900 flex items-start gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0"></span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-orange-50 p-5 rounded-xl border border-orange-200 space-y-3">
                  <h4 className="text-xs font-bold text-orange-700 uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Lỗ Hổng & Cần Khai Thác
                  </h4>
                  {(!evaluation.weaknesses || evaluation.weaknesses.length === 0) ? (
                    <p className="text-sm text-orange-600 italic">Ứng viên trả lời hoàn hảo.</p>
                  ) : (
                    <ul className="space-y-2">
                      {evaluation.weaknesses.map((w, i) => (
                        <li key={i} className="text-sm font-medium text-orange-900 flex items-start gap-2.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0"></span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {evaluation.followUpTopic && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="text-xs text-blue-900">
                      <span className="font-medium">Chủ đề tiếp theo: </span>
                      <strong className="font-bold">{evaluation.followUpTopic}</strong>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-gray-50 border-t border-gray-200 shrink-0 text-center">
        <p className="text-xs text-gray-500 font-medium">
          💡 Mẹo: Nhấn nút <strong className="text-blue-600">"Hỏi Câu Này"</strong> để tự động chèn vào luồng phỏng vấn
        </p>
      </div>

    </div>
  );
}
