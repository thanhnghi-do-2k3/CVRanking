class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; // Accumulate chunks
    this.buffer = new Int16Array(this.bufferSize);
    this.offset = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0]; // Mono channel
      
      for (let i = 0; i < channelData.length; i++) {
        // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
        let s = Math.max(-1, Math.min(1, channelData[i]));
        this.buffer[this.offset] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        this.offset++;

        if (this.offset >= this.bufferSize) {
          // Send the full buffer to the main thread
          // Send a copy so the underlying memory isn't transferred and lost
          this.port.postMessage(new Int16Array(this.buffer).buffer, [new Int16Array(this.buffer).buffer]);
          this.offset = 0;
        }
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);
