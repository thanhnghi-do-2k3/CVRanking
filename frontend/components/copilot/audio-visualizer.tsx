import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, RefreshCw, UserCheck, User, ShieldAlert, Cpu } from 'lucide-react';

type AudioVisualizerProps = {
  isListening: boolean;
  onToggleListen: () => void;
  currentSpeaker: 'interviewer' | 'candidate';
  onToggleSpeaker: () => void;
  autoDetectSpeaker: boolean;
  onToggleAutoDetect: () => void;
  speechSupported: boolean;
};

export function AudioVisualizer({
  isListening,
  onToggleListen,
  currentSpeaker,
  onToggleSpeaker,
  autoDetectSpeaker,
  onToggleAutoDetect,
  speechSupported
}: AudioVisualizerProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!isListening) return;

    let audioCtx: AudioContext | null = null;
    let streamNode: MediaStreamAudioSourceNode | null = null;
    let animId: number | null = null;
    let isActive = true;

    const startAudioAnalysis = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isActive) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        streamNode = audioCtx.createMediaStreamSource(stream);
        streamNode.connect(analyser);

        const updateEq = () => {
          if (!isActive) return;
          analyser.getByteFrequencyData(dataArray);

          const binIndices = [2, 4, 6, 8, 10, 12];
          binIndices.forEach((binIdx, idx) => {
            const el = barsRef.current[idx];
            if (el) {
              const val = dataArray[binIdx] || 0;
              const height = Math.max(4, Math.min(28, 4 + (val / 255) * 26));
              el.style.height = `${height}px`;
              el.style.opacity = `${Math.max(0.4, val / 255)}`;
            }
          });

          animId = requestAnimationFrame(updateEq);
        };

        updateEq();
      } catch (e) {
        console.warn("Audio analysis failed, fallback to css animation:", e);
      }
    };

    startAudioAnalysis();

    return () => {
      isActive = false;
      if (animId) cancelAnimationFrame(animId);
      if (streamNode && streamNode.mediaStream) {
        streamNode.mediaStream.getTracks().forEach(t => t.stop());
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, [isListening]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-6 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
        
        {/* Left: Speaker Role Switching & Auto Detect Toggle */}
        <div className="flex items-center gap-2.5 flex-wrap w-full sm:w-auto">
          <button
            onClick={onToggleSpeaker}
            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 border transition-colors ${
              autoDetectSpeaker
                ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                : currentSpeaker === 'interviewer'
                ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
            }`}
            title={autoDetectSpeaker ? "AI đang tự động nhận diện (Bấm để đổi thủ công)" : "Bấm để đổi vai thủ công"}
          >
            {autoDetectSpeaker ? (
              <>
                <Cpu className="w-4 h-4 text-purple-500" />
                <span>AI Phân Vai:</span>
                <span className="font-bold">
                  {currentSpeaker === 'interviewer' ? '👔 Bạn Hỏi' : '🧑‍💻 Ứng Viên'}
                </span>
              </>
            ) : currentSpeaker === 'interviewer' ? (
              <>
                <UserCheck className="w-4 h-4" />
                <span>👔 Bạn (Interviewer)</span>
              </>
            ) : (
              <>
                <User className="w-4 h-4" />
                <span>🧑‍💻 Ứng Viên (Candidate)</span>
              </>
            )}
            {!autoDetectSpeaker && <RefreshCw className="w-3.5 h-3.5 text-gray-400" />}
          </button>

          <button
            onClick={onToggleAutoDetect}
            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 border transition-colors ${
              autoDetectSpeaker
                ? 'bg-purple-100 text-purple-800 border-purple-300'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
            title="Sử dụng từ khóa và AI Lite Model để tự động nhận diện"
          >
            <Cpu className="w-4 h-4" />
            <span>AI Auto: {autoDetectSpeaker ? "BẬT" : "TẮT"}</span>
          </button>
        </div>

        {/* Right: Microphone Action */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {!speechSupported ? (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-1.5 rounded-md border border-red-200">
              <ShieldAlert className="w-4 h-4" />
              <span>Trình duyệt không hỗ trợ Mic</span>
            </div>
          ) : (
            <button
              onClick={onToggleListen}
              className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors w-full sm:w-auto justify-center ${
                isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-md animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>DỪNG LẮNG NGHE</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span>BẬT MIC NHẬN DIỆN</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Real-time Audio Volume Equalizer */}
      {isListening && (
        <div className="flex items-center justify-center pt-2 w-full">
          <div className="flex items-center justify-center gap-4 bg-gray-50 px-6 py-3 rounded-lg border border-gray-200 w-full max-w-xl">
            <div className="flex items-center justify-center gap-1 h-7">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div 
                  key={idx}
                  ref={(el) => { barsRef.current[idx] = el; }}
                  className="w-1 bg-blue-500 rounded-full"
                  style={{ height: '6px' }}
                ></div>
              ))}
            </div>
            <span className="text-sm font-semibold text-blue-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              ĐANG LẮNG NGHE & PHÂN TÍCH...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
