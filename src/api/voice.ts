/**
 * Voice API wrapper for Speech Recognition and Speech Synthesis
 */

export function isSpeechRecognitionSupported(): boolean {
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

export function isSpeechSynthesisSupported(): boolean {
  return !!window.speechSynthesis;
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return [];

  let voices = window.speechSynthesis.getVoices();

  if (voices.length === 0) {
    // Voices may load asynchronously; trigger the load
    window.speechSynthesis.onvoiceschanged = () => {};
    voices = window.speechSynthesis.getVoices();
  }

  return voices;
}

export function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSpeechSynthesisSupported()) {
      resolve([]);
      return;
    }

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices());
    };

    // Fallback timeout in case onvoiceschanged never fires
    setTimeout(() => {
      resolve(window.speechSynthesis.getVoices());
    }, 1000);
  });
}

export function speak(
  text: string,
  voice?: SpeechSynthesisVoice,
  rate: number = 1.0,
  pitch: number = 1.0
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isSpeechSynthesisSupported()) {
      reject(new Error("Speech synthesis not supported"));
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;

    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") {
        resolve();
      } else {
        reject(new Error(`Speech synthesis error: ${event.error}`));
      }
    };

    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Speak text sentence by sentence for streaming-style playback.
 * Each sentence is spoken sequentially, allowing early interruption
 * via stopSpeaking() between sentences.
 */
export async function speakStreaming(
  text: string,
  voice?: SpeechSynthesisVoice,
  rate?: number,
  pitch?: number
): Promise<void> {
  if (!isSpeechSynthesisSupported()) return;
  stopSpeaking();

  // Split into sentences (keeping the punctuation)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Check if speech was cancelled between sentences
    if (!window.speechSynthesis) return;

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (voice) utterance.voice = voice;
      if (rate !== undefined) utterance.rate = rate;
      if (pitch !== undefined) utterance.pitch = pitch;

      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        if (event.error === "canceled" || event.error === "interrupted") {
          resolve();
        } else {
          reject(new Error(`Speech synthesis error: ${event.error}`));
        }
      };

      window.speechSynthesis.speak(utterance);
    });
  }
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

export interface AudioRecorderOptions {
  onInterimTranscript?: (text: string) => void;
}

interface AudioRecorder {
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; transcript: string }>;
  isRecording: () => boolean;
}

export function createAudioRecorder(options?: AudioRecorderOptions): AudioRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let recognition: any = null;
  let audioChunks: Blob[] = [];
  let currentTranscript = "";
  let recording = false;

  return {
    start: async () => {
      audioChunks = [];
      currentTranscript = "";

      // Start MediaRecorder for audio blob
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.start(250); // Collect data every 250ms

      // Start SpeechRecognition in parallel for transcript
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: any) => {
          let interim = "";
          let final = "";
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }
          currentTranscript = final + interim;

          // Fire interim transcript callback for live updates
          if (options?.onInterimTranscript) {
            options.onInterimTranscript(currentTranscript);
          }
        };

        recognition.onerror = (event: any) => {
          // Silently handle recognition errors — audio blob still captures
          console.warn("SpeechRecognition error:", event.error);
        };

        recognition.start();
      }

      recording = true;
    },

    stop: () => {
      return new Promise((resolve) => {
        recording = false;

        // Stop recognition
        if (recognition) {
          try {
            recognition.stop();
          } catch {
            // Already stopped
          }
          recognition = null;
        }

        // Stop media recorder and collect blob
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, {
              type: mediaRecorder?.mimeType || "audio/webm",
            });

            // Stop all tracks on the stream
            mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
            mediaRecorder = null;

            resolve({ blob, transcript: currentTranscript });
          };

          mediaRecorder.stop();
        } else {
          resolve({
            blob: new Blob([], { type: "audio/webm" }),
            transcript: currentTranscript,
          });
        }
      });
    },

    isRecording: () => recording,
  };
}
