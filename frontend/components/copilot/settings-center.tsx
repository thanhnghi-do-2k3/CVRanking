import React, { useState } from 'react';
import { 
  Key, ExternalLink, ShieldCheck, Check, X, 
  Trash2, Globe, Mic, Activity,
  Sliders, CheckCircle2, ShieldAlert, Briefcase, Award, Target, BrainCircuit
} from 'lucide-react';
// @ts-ignore
import { PRESET_DOMAINS, PRESET_LEVELS } from '@/lib/copilot/data/jobPresets';

type SettingsCenterProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  apiKey: string;
  onSaveKey: (key: string) => void;
  jobDomain: string;
  onSelectDomain: (domain: string) => void;
  jobLevel: string;
  onSelectLevel: (level: string) => void;
  language: string;
  onToggleLanguage: () => void;
  speechSupported: boolean;
  currentSpeaker: 'interviewer' | 'candidate';
  onToggleSpeaker: () => void;
};

export function SettingsCenter({
  isOpen,
  onClose,
  initialTab = 'domain',
  apiKey,
  onSaveKey,
  jobDomain,
  onSelectDomain,
  jobLevel,
  onSelectLevel,
  language,
  onToggleLanguage,
  speechSupported,
  currentSpeaker,
  onToggleSpeaker
}: SettingsCenterProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [inputKey, setInputKey] = useState(apiKey || '');
  const [customDomain, setCustomDomain] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab === 'scenarios' ? 'domain' : initialTab);
      setInputKey(apiKey || '');
    }
  }, [isOpen, initialTab, apiKey]);

  if (!isOpen) return null;

  const handleSaveKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveKey(inputKey.trim());
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
    }, 1200);
  };

  const handleClearKey = () => {
    setInputKey('');
    onSaveKey('');
  };

  const handleApplyCustomDomain = (e: React.FormEvent) => {
    e.preventDefault();
    if (customDomain.trim()) {
      onSelectDomain(customDomain.trim());
      setCustomDomain('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white border border-gray-200 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-gray-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                <span>Trung Tâm Cấu Hình Copilot</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">REAL-TIME ENGINE</span>
              </h2>
              <p className="text-xs text-gray-500">
                Tùy chỉnh chuyên ngành phỏng vấn, khóa Gemini AI Key và âm thanh thời gian thực
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex border-b border-gray-100 bg-gray-50 px-6 pt-3 gap-2 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('domain')}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold text-xs transition-all whitespace-nowrap ${
              activeTab === 'domain'
                ? 'border-blue-500 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-t-lg'
            }`}
          >
            <Target className="w-4 h-4" />
            <span>🎯 Lĩnh Vực & Cấp Độ</span>
          </button>

          <button
            onClick={() => setActiveTab('apikey')}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold text-xs transition-all whitespace-nowrap ${
              activeTab === 'apikey'
                ? 'border-purple-500 text-purple-700 bg-white rounded-t-lg'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-t-lg'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>🔑 Gemini API Key</span>
            {apiKey ? (
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('audio')}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold text-xs transition-all whitespace-nowrap ${
              activeTab === 'audio'
                ? 'border-blue-500 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-t-lg'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span>🎙️ Giọng Nói & Ngôn Ngữ</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
          
          {/* TAB 1: DOMAIN & LEVEL */}
          {activeTab === 'domain' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-4">
                <BrainCircuit className="w-6 h-6 text-blue-600 shrink-0" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-blue-900">AI Custom Domain Intelligence</h3>
                  <p className="text-xs text-blue-800 leading-relaxed">
                    AI Copilot sẽ đóng vai Hội đồng phỏng vấn kỹ thuật cấp cao, tự động điều chỉnh độ sâu câu hỏi đào sâu và tiêu chuẩn chấm điểm theo đúng <strong>lĩnh vực chuyên môn và cấp độ</strong> bạn chọn dưới đây!
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                  <Award className="w-4 h-4 text-purple-500" />
                  <span>Bước 1: Chọn cấp độ mục tiêu (Seniority Level):</span>
                </h3>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {PRESET_LEVELS.map((lvl: any) => {
                    const isSelected = jobLevel === lvl.id || (jobLevel && jobLevel.includes(lvl.id));
                    return (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => onSelectLevel(lvl.id)}
                        className={`p-4 rounded-xl border text-left transition-all flex flex-col gap-1.5 ${
                          isSelected
                            ? 'border-purple-500 bg-purple-50 text-purple-900 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`text-xs uppercase tracking-wider font-mono font-bold ${isSelected ? 'text-purple-600' : 'text-gray-500'}`}>⚡ {lvl.id}</span>
                        <span className="text-xs leading-snug font-medium">{lvl.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-blue-500" />
                  <span>Bước 2: Chọn chuyên ngành phỏng vấn (Job Domain):</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {PRESET_DOMAINS.map((dom: any) => {
                    const isSelected = jobDomain === dom.title;
                    return (
                      <div
                        key={dom.id}
                        onClick={() => onSelectDomain(dom.title)}
                        className={`p-5 flex items-center justify-between cursor-pointer border rounded-xl transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-center gap-3.5">
                          <span className="text-2xl">{dom.icon}</span>
                          <div>
                            <h4 className={`text-sm font-bold transition-colors ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                              {dom.title}
                            </h4>
                            <span className="text-[11px] text-gray-500">
                              {isSelected ? '✓ Đang kích hoạt làm ngữ cảnh AI' : 'Bấm để chọn chuyên ngành này'}
                            </span>
                          </div>
                        </div>

                        <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-transparent'}`}>
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <form onSubmit={handleApplyCustomDomain} className="flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Hoặc tự nhập chức danh/công nghệ bạn muốn (ví dụ: Golang)..."
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-300 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!customDomain.trim()}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors"
                  >
                    Áp Dụng Riêng
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: API KEY */}
          {activeTab === 'apikey' && (
            <div className="space-y-6 max-w-2xl mx-auto py-2">
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-6 relative overflow-hidden">
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                    <Key className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-lg font-bold text-purple-900">Google Gemini AI Key</h3>
                    </div>
                    <p className="text-xs text-purple-800 mt-1 leading-relaxed">
                      Hệ thống kết nối với API Key của bạn. AI Copilot hoạt động với sức mạnh nhận diện, đào sâu câu hỏi và chấm điểm thời gian thực!
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSaveKeySubmit} className="space-y-5">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🔑 Gemini API Key đang sử dụng:</span>
                        {apiKey && <span className="text-green-600 font-normal lowercase">(Đang hoạt động)</span>}
                      </label>
                      
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-semibold underline underline-offset-4"
                      >
                        Lấy Key mới từ Google AI Studio
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    <div className="relative">
                      <input
                        type="password"
                        placeholder="AQ.Ab8RN6Iy..."
                        value={inputKey}
                        onChange={(e) => setInputKey(e.target.value)}
                        className="w-full bg-white border border-gray-300 focus:border-purple-500 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono transition-shadow shadow-sm"
                      />
                      {inputKey && (
                        <button
                          type="button"
                          onClick={handleClearKey}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 p-2 rounded-lg hover:bg-gray-100 transition-colors"
                          title="Xóa key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
                    <span>Bạn có thể cấu hình API key cá nhân để sử dụng. Key được lưu an toàn trên trình duyệt của bạn.</span>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg"
                    >
                      Đóng
                    </button>
                    <button
                      type="submit"
                      className={`px-6 py-2.5 text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 ${
                        showSuccess 
                          ? 'bg-green-600 text-white' 
                          : 'bg-purple-600 hover:bg-purple-700 text-white'
                      }`}
                    >
                      {showSuccess ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Đã Cập Nhật Key!</span>
                        </>
                      ) : (
                        <>
                          <Key className="w-4 h-4" />
                          <span>Lưu Cấu Hình Key</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 3: AUDIO & LANGUAGE */}
          {activeTab === 'audio' && (
            <div className="space-y-6 max-w-2xl mx-auto py-2">
              <div className="bg-white border border-gray-200 p-6 rounded-xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Globe className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-800">Ngôn ngữ Hội thoại & AI</h4>
                      <p className="text-xs text-gray-500">
                        Chọn ngôn ngữ để bộ nhận diện giọng nói (Speech-to-Text) hiểu đúng ngữ cảnh.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={onToggleLanguage}
                    className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg shrink-0"
                  >
                    {language === 'vi-VN' ? '🇻🇳 Tiếng Việt (Default)' : '🇬🇧 English (US)'}
                  </button>
                </div>
              </div>

              <div className="bg-white border border-gray-200 p-6 rounded-xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                      <Mic className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-800">Trạng thái Hỗ trợ Microphone</h4>
                      <p className="text-xs text-gray-500">
                        Kiểm tra Web Speech API trên trình duyệt hiện tại.
                      </p>
                    </div>
                  </div>

                  {speechSupported ? (
                    <span className="px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Sẵn Sàng
                    </span>
                  ) : (
                    <span className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4" />
                      Không Hỗ Trợ
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-white border border-gray-200 p-6 rounded-xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Activity className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-800">Vai trò Lượt nói Mặc định</h4>
                      <p className="text-xs text-gray-500">
                        Đang ở vai trò: <strong className="text-gray-800">{currentSpeaker === 'interviewer' ? '👔 Người Phỏng Vấn' : '🧑‍💻 Ứng Viên'}</strong>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={onToggleSpeaker}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg"
                  >
                    Chuyển đổi Vai trò
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer Bar */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>Hệ thống Copilot • Connected to Gemini Engine</span>
          </div>

          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg"
          >
            Hoàn Tất Cấu Hình
          </button>
        </div>

      </div>
    </div>
  );
}
