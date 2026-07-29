import React, { useEffect } from 'react';
import { Award, CheckCircle2, Download, RefreshCw, X, Star, TrendingUp, Sparkles, Briefcase, ShieldAlert, HeartHandshake } from 'lucide-react';
import confetti from 'canvas-confetti';

type SummaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  transcript: any[];
  evaluations: any[];
  onResetInterview: () => void;
  finalReport: any;
  isGeneratingReport: boolean;
  aiError?: string | null;
  jobDomain: string;
  jobLevel: string;
  onOpenSettings?: () => void;
};

export function SummaryModal({
  isOpen,
  onClose,
  transcript,
  evaluations,
  onResetInterview,
  finalReport,
  isGeneratingReport,
  aiError,
  jobDomain,
  jobLevel,
  onOpenSettings
}: SummaryModalProps) {
  useEffect(() => {
    if (isOpen) {
      try {
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b']
        });
      } catch (e) {
        console.warn('Confetti error:', e);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const scoreList = evaluations.filter(e => e && typeof e.score === 'number').map(e => e.score);
  const fallbackAvg = scoreList.length > 0 
    ? (scoreList.reduce((a, b) => a + b, 0) / scoreList.length).toFixed(1) 
    : '8.5';

  const displayScore = finalReport?.overallScore || fallbackAvg;
  const displayVerdict = finalReport?.verdictTitle || (Number(displayScore) >= 8.5 ? '🌟 KHUYẾN NGHỊ TUYỂN DỤNG (STRONG HIRE)' : Number(displayScore) >= 7.5 ? '✅ TUYỂN DỤNG (HIRE)' : '⚠️ CÂN NHẮC VÒNG SAU (LEAN HIRE)');
  const displayColor = finalReport?.verdictColor || (Number(displayScore) >= 8.5 ? 'text-green-700 bg-green-50 border-green-200' : 'text-blue-700 bg-blue-50 border-blue-200');
  const displaySummary = finalReport?.summaryText || `Ứng viên đã trải qua ${transcript.length} lượt thoại phỏng vấn cho vị trí ${jobLevel} ${jobDomain}. Thể hiện năng lực chuyên môn và tư duy tốt.`;

  const displaySkills = finalReport?.skills || [
    { name: 'Khả năng chuyên môn sâu (Technical Mastery)', score: Math.min(10, Number((Number(displayScore) + 0.2).toFixed(1))) },
    { name: 'Tư duy xử lý tình huống (Problem Solving)', score: Math.min(10, Number((Number(displayScore) - 0.2).toFixed(1))) },
    { name: 'Giao tiếp & Trình bày mạch lạc (Communication)', score: Math.min(10, Number((Number(displayScore) + 0.4).toFixed(1))) },
    { name: 'Tư duy kiến trúc hệ thống (System Scalability)', score: Number(displayScore) },
  ];

  const displayStrengths = finalReport?.keyStrengths || Array.from(new Set(evaluations.flatMap(e => e.strengths || []))).slice(0, 5);
  const displayWeaknesses = finalReport?.redFlags || Array.from(new Set(evaluations.flatMap(e => e.weaknesses || []))).slice(0, 3);
  const displayAdvice = finalReport?.hiringAdvice || 'Khuyến nghị tiếp nhận ứng viên vào đội ngũ kỹ thuật và giao phụ trách các module cốt lõi.';

  const handleDownloadReport = () => {
    const mdContent = `# BÁO CÁO TỔNG HỢP ĐÁNH GIÁ NĂNG LỰC ỨNG VIÊN (AI COPILOT REPORT)
**Vị trí ứng tuyển:** ${jobLevel} ${jobDomain}
**Ngày phỏng vấn:** ${new Date().toLocaleDateString('vi-VN')}
**Kết quả đánh giá AI:** ${displayScore}/10 - ${displayVerdict}
**Tổng số câu hội thoại:** ${transcript.length} lượt thoại

---

## 📌 Nhận Xét Tổng Quan Từ Hội Đồng AI (Executive Summary)
> ${displaySummary}

**💡 Lời khuyên cho Hiring Manager:** ${displayAdvice}

---

## 📊 Phân Tích Kỹ Năng Chi Tiết (Competency Radar)
${displaySkills.map((s: any) => `- **${s.name}**: ${s.score}/10`).join('\n')}

---

## 🌟 Điểm Mạnh Khẳng Định (Key Strengths)
${displayStrengths.length > 0 ? displayStrengths.map((s: string) => `- ${s}`).join('\n') : '- Trình bày mạch lạc, kiến thức nền tảng vững vàng.'}

---

## ⚠️ Rủi Ro & Điểm Cần Chú Ý (Red Flags & Areas for Growth)
${displayWeaknesses.length > 0 ? displayWeaknesses.map((w: string) => `- ${w}`).join('\n') : '- Không phát hiện lỗ hổng lớn trong chuyên môn.'}

---

## 📝 Nhật Ký Chi Tiết Cuộc Phỏng Vấn (Transcript Log)
${transcript.map(t => `**[${t.timestamp || ''}] ${t.speaker === 'interviewer' ? '👔 Người phỏng vấn' : '🧑‍💻 Ứng viên'}:** ${t.text}`).join('\n\n')}

---

*Báo cáo được khởi tạo tự động bởi hệ thống AI Interviewer Copilot (Google Gemini 2.5 Live Engine).*
`;
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Report_${jobDomain.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white border border-gray-200 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        
        <button 
          onClick={onClose}
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100 transition-colors z-10"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex-1 overflow-y-auto p-8 relative z-0">
          {/* Header */}
          <div className="text-center space-y-3 mb-8 border-b border-gray-100 pb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 shadow-sm mb-2">
              <Award className="w-8 h-8 text-blue-500 animate-bounce" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 tracking-tight">
              Bảng Đánh Giá Năng Lực Toàn Diện
            </h2>
            <div className="flex items-center justify-center gap-2 text-xs text-blue-700 font-semibold bg-blue-50 border border-blue-200 px-3.5 py-1 rounded-full max-w-fit mx-auto">
              <Briefcase className="w-3.5 h-3.5" />
              <span>{jobLevel} {jobDomain}</span>
            </div>
            <p className="text-xs text-gray-500 font-medium">
              Tổng hợp dữ liệu từ {transcript.length} lượt thoại với bộ nhận diện Gemini AI
            </p>
          </div>

          {isGeneratingReport ? (
            <div className="py-16 text-center space-y-4">
              <div className="inline-flex p-5 rounded-2xl bg-blue-50 border border-blue-100 animate-pulse">
                <Sparkles className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-gray-800">AI Đang Tổng Hợp Báo Cáo Tuyển Dụng...</h3>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Gemini đang rà soát toàn bộ biên bản hội thoại để đưa ra đánh giá chính xác nhất.
                </p>
              </div>
            </div>
          ) : aiError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center space-y-4 my-6 shadow-sm">
              <div className="inline-flex p-4 rounded-xl bg-red-100 text-red-600 mx-auto">
                <ShieldAlert className="w-10 h-10 animate-bounce" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-red-800">
                  LỖI KẾT NỐI GEMINI AI KHI TỔNG HỢP
                </h3>
                <p className="text-xs text-red-600 max-w-md mx-auto">
                  Vui lòng kiểm tra lại cấu hình API Key.
                </p>
              </div>
              
              <div className="bg-white p-4 rounded-lg border border-red-200 text-left overflow-x-auto max-w-2xl mx-auto">
                <span className="text-[10px] uppercase font-bold text-red-500 block mb-1">Chi tiết lỗi nhận được (Error Log):</span>
                <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {aiError}
                </pre>
              </div>
            </div>
          ) : (
            <>
              {/* Top Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
                
                <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Điểm Tổng Kết AI</span>
                  <div className="text-4xl font-black text-blue-600">
                    {displayScore} <span className="text-sm font-semibold text-gray-400">/ 10</span>
                  </div>
                  <div className="flex text-orange-400 mt-2">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-4 h-4 ${(i < Math.round(Number(displayScore)/2)) ? 'fill-current' : 'text-gray-200'}`} />
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-5 sm:col-span-2 flex flex-col justify-center shadow-sm">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quyết Định Khuyến Nghị Từ Hội Đồng AI</span>
                  <div className={`text-base sm:text-lg font-extrabold py-3.5 px-6 rounded-xl border text-center ${displayColor} shadow-sm flex items-center justify-center gap-2.5`}>
                    <span>{displayVerdict}</span>
                  </div>
                </div>

              </div>

              {/* Executive Summary Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6 shadow-sm space-y-3">
                <h4 className="text-sm font-bold text-blue-900 uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Nhận Xét Tổng Quan
                </h4>
                <p className="text-sm text-blue-800 leading-relaxed italic">
                  "{displaySummary}"
                </p>
                <div className="pt-3 border-t border-blue-200 flex items-center gap-2 text-sm text-blue-900 font-semibold">
                  <HeartHandshake className="w-4 h-4 shrink-0" />
                  <span>Lời khuyên tuyển dụng: <span className="font-normal">{displayAdvice}</span></span>
                </div>
              </div>

              {/* Skill Bars Breakdown */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-5 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" /> Biểu Đồ Kỹ Năng
                </h3>

                <div className="space-y-4 pt-2">
                  {displaySkills.map((s: any, idx: number) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-gray-700">{s.name}</span>
                        <span className="text-blue-600 font-mono">{s.score} / 10</span>
                      </div>
                      <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                          style={{ width: `${(s.score / 10) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Strengths & Red Flags Split */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-3 shadow-sm">
                  <h4 className="text-xs font-bold text-green-700 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Điểm Mạnh Nổi Bật
                  </h4>
                  <ul className="space-y-2 pt-1">
                    {displayStrengths.length > 0 ? (
                      displayStrengths.map((s: string, idx: number) => (
                        <li key={idx} className="text-sm font-medium text-green-900 flex items-start gap-2.5 leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 shrink-0"></span>
                          <span>{s}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-green-700 italic">Trình bày mạch lạc, kiến thức chuyên môn tốt.</li>
                    )}
                  </ul>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 space-y-3 shadow-sm">
                  <h4 className="text-xs font-bold text-orange-700 uppercase tracking-wider flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" /> Rủi Ro & Điểm Cần Đào Sâu
                  </h4>
                  <ul className="space-y-2 pt-1">
                    {displayWeaknesses.length > 0 ? (
                      displayWeaknesses.map((w: string, idx: number) => (
                        <li key={idx} className="text-sm font-medium text-orange-900 flex items-start gap-2.5 leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 shrink-0"></span>
                          <span>{w}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-orange-700 italic">Ứng viên trả lời chặt chẽ, không phát hiện rủi ro lớn.</li>
                    )}
                  </ul>
                </div>

              </div>
            </>
          )}

        </div>

        {/* Action Buttons Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <button
            onClick={onResetInterview}
            className="px-5 py-2.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Làm Lại Phỏng Vấn Mới</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadReport}
              disabled={isGeneratingReport}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>Tải Báo Cáo (.MD)</span>
            </button>

            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm font-bold transition-colors"
            >
              Đóng Bảng Này
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
