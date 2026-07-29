import React, { useRef, useEffect, useState, FormEvent } from 'react';
import { MessageSquare, Trash2, Send, UserCheck, User, Clock, Terminal } from 'lucide-react';

export type TranscriptItem = {
  speaker: 'interviewer' | 'candidate';
  text: string;
  timestamp: string;
};

type TranscriptPanelProps = {
  transcript: TranscriptItem[];
  interimText: string;
  currentSpeaker: 'interviewer' | 'candidate';
  onAddManualMessage: (text: string, speaker: string) => void;
  onClearTranscript: () => void;
  _isListening?: boolean;
  autoDetectSpeaker: boolean;
};

export function TranscriptPanel({
  transcript,
  interimText,
  currentSpeaker,
  onAddManualMessage,
  onClearTranscript,
  _isListening,
  autoDetectSpeaker
}: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [manualInput, setManualInput] = useState('');
  const [manualSpeaker, setManualSpeaker] = useState(() => autoDetectSpeaker ? 'auto' : 'interviewer');

  useEffect(() => {
    if (autoDetectSpeaker) {
      setManualSpeaker('auto');
    } else if (manualSpeaker === 'auto') {
      setManualSpeaker(currentSpeaker || 'interviewer');
    }
  }, [autoDetectSpeaker, currentSpeaker, manualSpeaker]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimText]);

  const handleSendManual = (e: FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    onAddManualMessage(manualInput.trim(), manualSpeaker);
    setManualInput('');
  };

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
              Live Conversation Feed
            </h2>
            <p className="text-xs text-gray-500">Thời gian thực • Tự động phân tách lượt nói</p>
          </div>
          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            {transcript.length} Lượt thoại
          </span>
        </div>

        {transcript.length > 0 && (
          <button
            onClick={onClearTranscript}
            className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1.5 transition-colors px-3 py-1.5 rounded-md hover:bg-red-50 border border-transparent hover:border-red-200"
            title="Xóa lịch sử cuộc phỏng vấn hiện tại"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="font-semibold">Xóa hội thoại</span>
          </button>
        )}
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
        {transcript.length === 0 && !interimText ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500 space-y-4 my-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-blue-400" />
            </div>
            <div className="max-w-sm space-y-2">
              <h3 className="text-base font-bold text-gray-700">Sẵn Sàng Ghi Nhận Phỏng Vấn Live</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Bật <strong>Mic</strong> để hệ thống lắng nghe giọng nói thời gian thực, hoặc nhập trực tiếp câu thoại vào khung chat bên dưới để AI Copilot phân tích ngay!
              </p>
            </div>
          </div>
        ) : (
          transcript.map((item, idx) => {
            const isInt = item.speaker === 'interviewer';
            return (
              <div
                key={idx}
                className={`flex flex-col ${isInt ? 'items-start' : 'items-end'} mb-4`}
              >
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  {isInt ? (
                    <span className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" />
                      👔 Bạn Hỏi
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-green-700 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" />
                      🧑‍💻 Ứng Viên Đáp
                    </span>
                  )}
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {item.timestamp || 'Vừa xong'}
                  </span>
                </div>
                
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  isInt 
                    ? 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm' 
                    : 'bg-blue-50 border border-blue-100 text-blue-900 rounded-tr-sm'
                }`}>
                  <p className="whitespace-pre-wrap">{item.text}</p>
                </div>
              </div>
            );
          })
        )}

        {/* Interim Text Stream */}
        {interimText && (
          <div className={`flex flex-col ${currentSpeaker === 'interviewer' ? 'items-start' : 'items-end'} opacity-80 mb-4`}>
            <div className="flex items-center gap-2 mb-1.5 px-1">
              <span className="text-xs font-semibold text-orange-600 flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                🔴 Đang nói ({currentSpeaker === 'interviewer' ? 'Bạn' : 'Ứng viên'})...
              </span>
            </div>
            <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed border border-dashed border-orange-300 bg-orange-50/50 text-orange-800 ${
              currentSpeaker === 'interviewer' ? 'rounded-tl-sm' : 'rounded-tr-sm'
            }`}>
              <p className="italic">{interimText}...</p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Manual Input Bar */}
      <div className="p-4 border-t border-gray-200 bg-white shrink-0">
        <form onSubmit={handleSendManual} className="flex items-center gap-3">
          <select
            value={manualSpeaker}
            onChange={(e) => setManualSpeaker(e.target.value)}
            className="bg-gray-50 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer shrink-0"
          >
            {autoDetectSpeaker && <option value="auto">🤖 AI Phân Vai</option>}
            <option value="interviewer">👔 Bạn Hỏi (Thủ công)</option>
            <option value="candidate">🧑‍💻 Ứng Viên Đáp (Thủ công)</option>
          </select>

          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Gõ văn bản nếu không dùng Mic..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              className="w-full bg-white border border-gray-300 focus:border-blue-500 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow shadow-sm"
            />
          </div>

          <button
            type="submit"
            disabled={!manualInput.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm shrink-0"
            title="Gửi câu thoại vào hội thoại"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Gửi</span>
          </button>
        </form>
      </div>

    </div>
  );
}
