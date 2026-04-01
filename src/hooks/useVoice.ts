import { useCallback, useRef } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speak,
  speakStreaming,
  stopSpeaking as stopSpeakingApi,
  getVoicesAsync,
  createAudioRecorder,
} from "../api/voice";

export function useVoice() {
  const store = useVoiceStore();
  const recorderRef = useRef<ReturnType<typeof createAudioRecorder> | null>(null);
  const onInterimRef = useRef<((text: string) => void) | null>(null);

  const sttSupported = isSpeechRecognitionSupported();
  const ttsSupported = isSpeechSynthesisSupported();

  const startRecording = useCallback(async (onInterimTranscript?: (text: string) => void) => {
    if (recorderRef.current?.isRecording()) return;

    onInterimRef.current = onInterimTranscript || null;

    const recorder = createAudioRecorder({
      onInterimTranscript: (text: string) => {
        if (onInterimRef.current) {
          onInterimRef.current(text);
        }
      },
    });
    recorderRef.current = recorder;

    try {
      await recorder.start();
      store.setRecording(true);
      store.setTranscript("");
    } catch (err) {
      console.error("Failed to start recording:", err);
      recorderRef.current = null;
    }
  }, [store]);

  const stopRecording = useCallback(async (): Promise<string> => {
    if (!recorderRef.current) return "";

    try {
      const { transcript } = await recorderRef.current.stop();
      store.setRecording(false);
      store.setTranscript(transcript);
      recorderRef.current = null;
      onInterimRef.current = null;
      return transcript;
    } catch (err) {
      console.error("Failed to stop recording:", err);
      store.setRecording(false);
      recorderRef.current = null;
      onInterimRef.current = null;
      return "";
    }
  }, [store]);

  const speakText = useCallback(
    async (text: string) => {
      if (!ttsSupported || !store.ttsEnabled) return;

      store.setSpeaking(true);

      try {
        let voice: SpeechSynthesisVoice | undefined;
        if (store.ttsVoice) {
          const voices = await getVoicesAsync();
          voice = voices.find((v) => v.name === store.ttsVoice);
        }

        await speak(text, voice, store.ttsRate, store.ttsPitch);
      } catch (err) {
        console.error("Speech synthesis error:", err);
      } finally {
        store.setSpeaking(false);
      }
    },
    [store, ttsSupported]
  );

  const speakTextStreaming = useCallback(
    async (text: string) => {
      if (!ttsSupported || !store.ttsEnabled) return;

      store.setSpeaking(true);

      try {
        let voice: SpeechSynthesisVoice | undefined;
        if (store.ttsVoice) {
          const voices = await getVoicesAsync();
          voice = voices.find((v) => v.name === store.ttsVoice);
        }

        await speakStreaming(text, voice, store.ttsRate, store.ttsPitch);
      } catch (err) {
        console.error("Speech synthesis streaming error:", err);
      } finally {
        store.setSpeaking(false);
      }
    },
    [store, ttsSupported]
  );

  const stopSpeaking = useCallback(() => {
    stopSpeakingApi();
    store.setSpeaking(false);
  }, [store]);

  return {
    isRecording: store.isRecording,
    isSpeaking: store.isSpeaking,
    transcript: store.transcript,
    sttSupported,
    ttsSupported,
    startRecording,
    stopRecording,
    speakText,
    speakTextStreaming,
    stopSpeaking,
  };
}
