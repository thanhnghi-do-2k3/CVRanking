class SpeechService {
  constructor() {
    this.recognition = null;
    this.isSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    this.speaker = 'interviewer'; // default
    this.language = 'vi-VN';
    this.isListening = false;
    this.onResultCallback = null;
    this.debounceTimer = null;
    this.currentInterim = '';
    this.lastFinal = '';

    if (this.isSupported) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.language;

      this.recognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        if (interim) {
           if (!this.currentInterim) {
              this.lastFinal = ''; // reset on new phrase
           }
           this.currentInterim = interim;
           if (this.onResultCallback) {
             this.onResultCallback({
               interimTranscript: interim,
               finalTranscript: null,
               speaker: this.speaker,
               timestamp: Date.now()
             });
           }
           
           // Debounce 800ms to auto flush as final
           clearTimeout(this.debounceTimer);
           this.debounceTimer = setTimeout(() => {
              if (this.currentInterim) {
                 this.flushFinal();
              }
           }, 800);
        }

        if (final) {
           clearTimeout(this.debounceTimer);
           this.currentInterim = '';
           if (final.trim() !== this.lastFinal) {
              this.lastFinal = final.trim();
              if (this.onResultCallback) {
                 this.onResultCallback({
                    interimTranscript: null,
                    finalTranscript: final.trim(),
                    speaker: this.speaker,
                    timestamp: Date.now()
                 });
              }
           }
        }
      };

      this.recognition.onerror = (event) => {
        if (event.error === 'aborted') return;
        console.warn('SpeechRecognition error:', event.error);
        if (event.error === 'not-allowed') {
          this.stopListening();
        }
      };

      this.recognition.onend = () => {
        if (this.isListening) {
           try {
               this.recognition.start(); // Auto restart if it stops unexpectedly
           } catch (e) {
               console.warn("Failed to restart speech recognition:", e);
           }
        }
      };
    }
  }

  flushFinal() {
    if (this.currentInterim && this.onResultCallback) {
       const textToFlush = this.currentInterim.trim();
       this.currentInterim = '';
       if (textToFlush !== this.lastFinal) {
           this.lastFinal = textToFlush;
           this.onResultCallback({
               interimTranscript: null,
               finalTranscript: textToFlush,
               speaker: this.speaker,
               timestamp: Date.now()
           });
       }
       // Restart recognition to clear interim buffer and prevent native duplicate final
       if (this.isListening) {
           this.recognition.abort(); // abort() instead of stop() to drop the pending final event
           // onend will trigger a restart
       }
    }
  }

  setLanguage(lang) {
    this.language = lang;
    if (this.recognition) {
       this.recognition.lang = lang;
       if (this.isListening) {
          this.recognition.stop();
          // onend will restart it with new lang
       }
    }
  }

  setSpeaker(speaker) {
    this.speaker = speaker;
  }

  toggleSpeaker() {
    this.speaker = this.speaker === 'interviewer' ? 'candidate' : 'interviewer';
    return this.speaker;
  }

  startListening(callback) {
    if (!this.isSupported) return false;
    this.onResultCallback = callback;
    if (!this.isListening) {
       this.isListening = true;
       try {
         this.recognition.start();
       } catch (e) {
         console.warn("Already started", e);
       }
    }
    return true;
  }

  stopListening() {
    this.isListening = false;
    clearTimeout(this.debounceTimer);
    if (this.recognition) {
       this.recognition.stop();
    }
  }
}

export const speechService = new SpeechService();
