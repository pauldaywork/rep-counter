/** Records a mic stream as compressed audio, so an attempt can be listened to later. */
export interface AudioRecorder {
  /** Stops recording if it hasn't stopped already and returns the audio. */
  finish(): Promise<Blob>;
}

export const AUDIO_TYPE = "audio/webm;codecs=opus";
/** Speech-quality Opus, about 240 KB per minute. */
const BITS_PER_SECOND = 32_000;
/** Hand over data every second, so a mic that disconnects still leaves its audio. */
const CHUNK_MS = 1000;
/** A recorder that never reports stopping must not hang the page. */
const STOP_TIMEOUT_MS = 3000;

export function recordAudio(stream: MediaStream): AudioRecorder {
  const recorder = new MediaRecorder(stream, { mimeType: AUDIO_TYPE, audioBitsPerSecond: BITS_PER_SECOND });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  // The recorder also stops by itself when the mic's track ends.
  const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve()));
  recorder.start(CHUNK_MS);

  return {
    async finish() {
      if (recorder.state !== "inactive") recorder.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The audio recorder didn't stop.")), STOP_TIMEOUT_MS);
      });
      try {
        await Promise.race([stopped, timeout]);
      } finally {
        clearTimeout(timer);
      }
      return new Blob(chunks, { type: AUDIO_TYPE });
    },
  };
}
