export class AudioStreamer {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.onAudioData = null;
    this.isRecording = false;
  }

  async start(onAudioDataCallback) {
    this.onAudioData = onAudioDataCallback;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      await this.audioContext.audioWorklet.addModule('/audio-processor.js');

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

      this.workletNode.port.onmessage = (event) => {
        if (this.onAudioData && this.isRecording) {
          // event.data is an ArrayBuffer (Int16 PCM)
          const pcm16 = new Int16Array(event.data);
          let sumSquares = 0;
          for (let i = 0; i < pcm16.length; i++) {
            sumSquares += pcm16[i] * pcm16[i];
          }
          const rms = Math.sqrt(sumSquares / pcm16.length);

          // Noise gate threshold: ~300 out of 32768
          if (rms > 300) {
            // Convert to Base64
            const base64Data = this.arrayBufferToBase64(event.data);
            this.onAudioData(base64Data);
          }
        }
      };

      source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      this.isRecording = true;
      return true;
    } catch (err) {
      console.error('Failed to start audio streamer:', err);
      return false;
    }
  }

  stop() {
    this.isRecording = false;
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // Fast ArrayBuffer to Base64 converter
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

export const audioStreamer = new AudioStreamer();
