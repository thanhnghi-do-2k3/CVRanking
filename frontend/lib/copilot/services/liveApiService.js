export class LiveApiService {
  constructor() {
    this.ws = null;
    this.apiKey = null;
    this.onText = null;
    this.onTurnComplete = null;
    this.onError = null;
    this.onClose = null;
  }

  connect(apiKey, jobDomain, jobLevel) {
    this.apiKey = apiKey;
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('Connected to Gemini Live API');
      // Send initial setup message
      const setupMsg = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            responseModalities: ["TEXT"],
          },
          systemInstruction: {
            parts: [{
              text: `Bạn là một AI Copilot hỗ trợ người phỏng vấn. Bạn đang nghe đoạn hội thoại phỏng vấn trực tiếp giữa Giám khảo và Ứng viên cho vị trí "${jobLevel} ${jobDomain}".
Nhiệm vụ của bạn:
1. Lắng nghe và theo dõi cuộc trò chuyện.
2. KHÔNG BAO GIỜ được nói to ra (không tạo audio).
3. HÃY CHỦ ĐỘNG VÀ THƯỜNG XUYÊN đưa ra gợi ý! Bất cứ khi nào Ứng viên hoặc Giám khảo vừa dứt lời (dù là ý ngắn hay có khoảng lặng nhỏ), hãy lập tức tóm tắt nhanh và đưa ra các câu hỏi gợi ý tiếp theo (Deep-dive) cho Giám khảo bằng tiếng Việt. Không cần chờ ứng viên nói xong một ý dài.
4. Trình bày văn bản gợi ý thật rõ ràng, ví dụ: 
"Tóm tắt: ...\n\nGợi ý câu hỏi:\n1. ...\n2. ...\n3. ..."
`
            }]
          }
        }
      };
      this.ws.send(JSON.stringify(setupMsg));
    };

    this.ws.onmessage = (event) => {
      try {
        if (event.data instanceof Blob) {
          // Live API sends JSON but sometimes as blob over WS in some environments, though usually it's string.
          const reader = new FileReader();
          reader.onload = () => this.handleMessage(JSON.parse(reader.result));
          reader.readAsText(event.data);
        } else {
          this.handleMessage(JSON.parse(event.data));
        }
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
      if (this.onError) this.onError(err);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from Gemini Live API');
      if (this.onClose) this.onClose();
    };
  }

  handleMessage(data) {
    if (data.serverContent) {
      const serverContent = data.serverContent;
      
      // Handle model turn complete
      if (serverContent.turnComplete) {
        if (this.onTurnComplete) this.onTurnComplete();
      }
      
      // Handle text output
      if (serverContent.modelTurn && serverContent.modelTurn.parts) {
        const parts = serverContent.modelTurn.parts;
        for (const part of parts) {
          if (part.text) {
            if (this.onText) this.onText(part.text);
          }
        }
      }
    }
  }

  sendAudioChunk(base64PCM) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = {
        realtimeInput: {
          mediaChunks: [{
            mimeType: "audio/pcm;rate=16000",
            data: base64PCM
          }]
        }
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendTextMessage(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = {
        clientContent: {
          turns: [{
            role: "user",
            parts: [{ text: text }]
          }],
          turnComplete: true
        }
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const liveApiService = new LiveApiService();
