// src/engine/molecules/tts.ts
// TTS/STT molecule extracted from chat_controller.ts.
// Instance-able: all functions receive references rather than using globals.
// Owns: speakMessage, autoSpeakIfEnabled, talk mode (record → transcribe).

import { pawEngine } from '../../engine';
import { showToast } from '../../components/toast';

// ── Types ────────────────────────────────────────────────────────────────

export interface TtsState {
  ttsAudio: HTMLAudioElement | null;
  ttsActiveBtn: HTMLButtonElement | null;
}

export interface TalkModeController {
  /** Whether talk mode is currently recording. */
  isActive(): boolean;
  /** Toggle talk mode on/off. */
  toggle(): Promise<void>;
  /** Start recording. */
  start(): Promise<void>;
  /** Stop recording (triggers transcription). */
  stop(): void;
  /** Full cleanup: stop recording, release stream. */
  cleanup(): void;
}

// ── Speak message ────────────────────────────────────────────────────────

/**
 * Speak a message using TTS.
 * Toggles playback if the same button is clicked again.
 * Scoped: operates on the provided TtsState, not globals.
 */
export async function speakMessage(
  text: string,
  btn: HTMLButtonElement,
  state: TtsState,
): Promise<void> {
  // Toggle off if same button
  if (state.ttsAudio && state.ttsActiveBtn === btn) {
    state.ttsAudio.pause();
    state.ttsAudio = null;
    btn.innerHTML = `<span class="ms">volume_up</span>`;
    btn.classList.remove('tts-playing');
    state.ttsActiveBtn = null;
    return;
  }
  // Stop any other playback
  if (state.ttsAudio) {
    state.ttsAudio.pause();
    state.ttsAudio = null;
    if (state.ttsActiveBtn) {
      state.ttsActiveBtn.innerHTML = `<span class="ms">volume_up</span>`;
      state.ttsActiveBtn.classList.remove('tts-playing');
    }
  }
  btn.innerHTML = `<span class="ms">hourglass_top</span>`;
  btn.classList.add('tts-loading');
  try {
    const base64Audio = await pawEngine.ttsSpeak(text);
    const audioBytes = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
    const blob = new Blob([audioBytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);
    state.ttsAudio = new Audio(url);
    state.ttsActiveBtn = btn;
    btn.innerHTML = `<span class="ms">stop_circle</span>`;
    btn.classList.remove('tts-loading');
    btn.classList.add('tts-playing');
    state.ttsAudio.addEventListener('ended', () => {
      btn.innerHTML = `<span class="ms">volume_up</span>`;
      btn.classList.remove('tts-playing');
      URL.revokeObjectURL(url);
      state.ttsAudio = null;
      state.ttsActiveBtn = null;
    });
    state.ttsAudio.addEventListener('error', () => {
      btn.innerHTML = `<span class="ms">volume_up</span>`;
      btn.classList.remove('tts-playing');
      URL.revokeObjectURL(url);
      state.ttsAudio = null;
      state.ttsActiveBtn = null;
    });
    state.ttsAudio.play();
  } catch (e) {
    console.error('[tts] Error:', e);
    btn.innerHTML = `<span class="ms">volume_up</span>`;
    btn.classList.remove('tts-loading', 'tts-playing');
    showToast(e instanceof Error ? e.message : 'TTS failed — check Voice settings', 'error');
  }
}

/**
 * Auto-speak if the TTS config has auto_speak enabled.
 * Scoped: operates on the provided TtsState.
 */
export async function autoSpeakIfEnabled(text: string, state: TtsState): Promise<void> {
  try {
    const cfg = await pawEngine.ttsGetConfig();
    if (!cfg.auto_speak) return;
    const base64Audio = await pawEngine.ttsSpeak(text);
    const audioBytes = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
    const blob = new Blob([audioBytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);
    if (state.ttsAudio) state.ttsAudio.pause();
    state.ttsAudio = new Audio(url);
    state.ttsAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      state.ttsAudio = null;
    });
    state.ttsAudio.play();
  } catch (e) {
    console.warn('[tts] Auto-speak failed:', e);
  }
}

// ── Talk Mode (voice-to-text) ────────────────────────────────────────────

/**
 * Create a scoped talk mode controller.
 * Records audio, sends to Whisper backend, injects transcript into a target element.
 *
 * @param getTargetInput — Returns the textarea to inject transcript into.
 * @param getTalkBtn — Returns the talk mode button element.
 * @param maxDurationMs — Max recording duration before auto-stop (default: 30s).
 */
export function createTalkMode(
  getTargetInput: () => HTMLTextAreaElement | null,
  getTalkBtn: () => HTMLElement | null,
  maxDurationMs = 30_000,
): TalkModeController {
  let active = false;
  let mediaRecorder: MediaRecorder | null = null;
  let audioStream: MediaStream | null = null;
  let talkTimeout: ReturnType<typeof setTimeout> | null = null;

  function cleanup(): void {
    if (talkTimeout) {
      clearTimeout(talkTimeout);
      talkTimeout = null;
    }
    active = false;
    mediaRecorder = null;
    if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
    const btn = getTalkBtn();
    if (btn) {
      btn.innerHTML = `<span class="ms">mic</span>`;
      btn.classList.remove('talk-active');
      btn.title = 'Talk Mode — hold to speak';
    }
  }

  async function start(): Promise<void> {
    const btn = getTalkBtn();
    if (!btn) return;

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      active = true;
      btn.innerHTML = `<span class="ms">stop_circle</span>`;
      btn.classList.add('talk-active');
      btn.title = 'Stop recording';

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';

      mediaRecorder = new MediaRecorder(audioStream, { mimeType });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        cleanup();
        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 4000) {
          showToast('Recording too short — try again', 'info');
          return;
        }

        const talkBtn = getTalkBtn();
        if (talkBtn) {
          talkBtn.innerHTML = `<span class="ms">hourglass_top</span>`;
          talkBtn.title = 'Transcribing...';
        }

        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });

          const transcript = await pawEngine.ttsTranscribe(base64, mimeType);
          if (transcript.trim()) {
            const chatInput = getTargetInput();
            if (chatInput) {
              chatInput.value = transcript;
              chatInput.style.height = 'auto';
              chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
              chatInput.focus();
            }
          } else {
            showToast('No speech detected — try again', 'info');
          }
        } catch (e) {
          console.error('[talk] Transcription error:', e);
          showToast(`Transcription failed: ${e instanceof Error ? e.message : e}`, 'error');
        } finally {
          const finalBtn = getTalkBtn();
          if (finalBtn) {
            finalBtn.innerHTML = `<span class="ms">mic</span>`;
            finalBtn.title = 'Talk Mode — hold to speak';
          }
        }
      };

      mediaRecorder.start();

      // Auto-stop after max duration
      talkTimeout = setTimeout(() => {
        talkTimeout = null;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, maxDurationMs);
    } catch (e) {
      showToast('Microphone access denied', 'error');
      console.error('[talk] Mic error:', e);
      cleanup();
    }
  }

  function stop(): void {
    if (talkTimeout) {
      clearTimeout(talkTimeout);
      talkTimeout = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  async function toggle(): Promise<void> {
    if (active) {
      stop();
    } else {
      await start();
    }
  }

  return {
    isActive: () => active,
    toggle,
    start,
    stop,
    cleanup,
  };
}
