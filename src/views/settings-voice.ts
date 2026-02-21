// Settings: Voice — TTS Configuration, ElevenLabs, Talk Mode

import { pawEngine, TtsConfig } from '../engine';
import { showToast } from '../components/toast';

import { $ } from '../components/helpers';

// ── Google Cloud TTS voice catalog ──────────────────────────────────────

const GOOGLE_VOICES: { id: string; label: string; gender: string }[] = [
  // Chirp 3 HD (latest, highest quality)
  { id: 'en-US-Chirp3-HD-Achernar', label: 'Achernar (Chirp 3 HD)', gender: 'F' },
  { id: 'en-US-Chirp3-HD-Aoede', label: 'Aoede (Chirp 3 HD)', gender: 'F' },
  { id: 'en-US-Chirp3-HD-Charon', label: 'Charon (Chirp 3 HD)', gender: 'M' },
  { id: 'en-US-Chirp3-HD-Fenrir', label: 'Fenrir (Chirp 3 HD)', gender: 'M' },
  { id: 'en-US-Chirp3-HD-Kore', label: 'Kore (Chirp 3 HD)', gender: 'F' },
  { id: 'en-US-Chirp3-HD-Leda', label: 'Leda (Chirp 3 HD)', gender: 'F' },
  { id: 'en-US-Chirp3-HD-Orus', label: 'Orus (Chirp 3 HD)', gender: 'M' },
  { id: 'en-US-Chirp3-HD-Puck', label: 'Puck (Chirp 3 HD)', gender: 'M' },
  { id: 'en-US-Chirp3-HD-Sulafat', label: 'Sulafat (Chirp 3 HD)', gender: 'F' },
  { id: 'en-US-Chirp3-HD-Zephyr', label: 'Zephyr (Chirp 3 HD)', gender: 'F' },
  // Neural2
  { id: 'en-US-Neural2-A', label: 'Neural2-A', gender: 'M' },
  { id: 'en-US-Neural2-C', label: 'Neural2-C', gender: 'F' },
  { id: 'en-US-Neural2-D', label: 'Neural2-D', gender: 'M' },
  { id: 'en-US-Neural2-F', label: 'Neural2-F', gender: 'F' },
  { id: 'en-US-Neural2-H', label: 'Neural2-H', gender: 'F' },
  { id: 'en-US-Neural2-J', label: 'Neural2-J', gender: 'M' },
  // Journey
  { id: 'en-US-Journey-D', label: 'Journey-D', gender: 'M' },
  { id: 'en-US-Journey-F', label: 'Journey-F', gender: 'F' },
  { id: 'en-US-Journey-O', label: 'Journey-O', gender: 'F' },
];

const OPENAI_VOICES: { id: string; label: string; gender: string }[] = [
  { id: 'alloy', label: 'Alloy', gender: 'N' },
  { id: 'ash', label: 'Ash', gender: 'M' },
  { id: 'coral', label: 'Coral', gender: 'F' },
  { id: 'echo', label: 'Echo', gender: 'M' },
  { id: 'fable', label: 'Fable', gender: 'M' },
  { id: 'nova', label: 'Nova', gender: 'F' },
  { id: 'onyx', label: 'Onyx', gender: 'M' },
  { id: 'sage', label: 'Sage', gender: 'F' },
  { id: 'shimmer', label: 'Shimmer', gender: 'F' },
];

const ELEVENLABS_VOICES: { id: string; label: string; gender: string }[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', gender: 'F' },
  { id: 'IKne3meq5aSn9XLyUdCD', label: 'Charlie', gender: 'M' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', gender: 'M' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum', gender: 'M' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam', gender: 'M' },
  { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte', gender: 'F' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice', gender: 'F' },
  { id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda', gender: 'F' },
  { id: 'bIHbv24MWmeRgasZH58o', label: 'Will', gender: 'M' },
  { id: 'cgSgspJ2msm6clMCkdW9', label: 'Jessica', gender: 'F' },
  { id: 'cjVigY5qzO86Huf0OWal', label: 'Eric', gender: 'M' },
  { id: 'iP95p4xoKVk53GoZ742B', label: 'Chris', gender: 'M' },
  { id: 'nPczCjzI2devNBz1zQrb', label: 'Brian', gender: 'M' },
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel', gender: 'M' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', label: 'Lily', gender: 'F' },
  { id: 'pqHfZKP75CvOlQylNhV4', label: 'Bill', gender: 'M' },
];

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-AU', label: 'English (AU)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (BR)' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ar-XA', label: 'Arabic' },
];

let _config: TtsConfig = {
  provider: 'google',
  voice: 'en-US-Chirp3-HD-Achernar',
  speed: 1.0,
  language_code: 'en-US',
  auto_speak: false,
  elevenlabs_api_key: '',
  elevenlabs_model: 'eleven_multilingual_v2',
  stability: 0.5,
  similarity_boost: 0.75,
};

// ── Helpers ─────────────────────────────────────────────────────────────

function voicesForProvider(provider: string) {
  switch (provider) {
    case 'openai': return OPENAI_VOICES;
    case 'elevenlabs': return ELEVENLABS_VOICES;
    default: return GOOGLE_VOICES;
  }
}

function providerHint(provider: string): string {
  switch (provider) {
    case 'openai': return 'Uses your OpenAI API key from Models settings. $15/1M characters.';
    case 'elevenlabs': return 'Uses your ElevenLabs API key (entered below). Premium neural voices.';
    default: return 'Uses your Google API key from Models settings. Chirp 3 HD voices are highest quality.';
  }
}

function buildFormConfig(): TtsConfig {
  return {
    provider: ($('tts-provider') as HTMLSelectElement)?.value || 'google',
    voice: ($('tts-voice') as HTMLSelectElement)?.value || 'en-US-Chirp3-HD-Achernar',
    speed: parseFloat(($('tts-speed') as HTMLInputElement)?.value || '1.0'),
    language_code: ($('tts-language') as HTMLSelectElement)?.value || 'en-US',
    auto_speak: ($('tts-auto-speak') as HTMLInputElement)?.checked ?? false,
    elevenlabs_api_key: ($('tts-elevenlabs-key') as HTMLInputElement)?.value || '',
    elevenlabs_model: ($('tts-elevenlabs-model') as HTMLSelectElement)?.value || 'eleven_multilingual_v2',
    stability: parseFloat(($('tts-stability') as HTMLInputElement)?.value || '0.5'),
    similarity_boost: parseFloat(($('tts-similarity') as HTMLInputElement)?.value || '0.75'),
  };
}

// ── TTS Settings ────────────────────────────────────────────────────────

export async function loadVoiceSettings() {
  const container = $('settings-voice-content');
  if (!container) return;

  // Load config from backend
  try {
    _config = await pawEngine.ttsGetConfig();
  } catch (e) {
    console.warn('[voice] Failed to load TTS config, using defaults:', e);
  }

  const voices = voicesForProvider(_config.provider);
  const isEL = _config.provider === 'elevenlabs';
  const isGoogle = _config.provider === 'google';

  container.innerHTML = `
    <div class="settings-form">

      <!-- TTS Provider -->
      <div class="form-group">
        <label class="form-label">TTS Provider</label>
        <select class="form-input" id="tts-provider">
          <option value="google" ${_config.provider === 'google' ? 'selected' : ''}>Google Cloud TTS</option>
          <option value="openai" ${_config.provider === 'openai' ? 'selected' : ''}>OpenAI TTS</option>
          <option value="elevenlabs" ${_config.provider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs</option>
        </select>
        <div class="form-hint" id="tts-provider-hint">${providerHint(_config.provider)}</div>
      </div>

      <!-- ElevenLabs-specific settings -->
      <div id="tts-elevenlabs-group" style="${isEL ? '' : 'display:none'}">
        <div class="form-group">
          <label class="form-label">ElevenLabs API Key</label>
          <input type="password" class="form-input" id="tts-elevenlabs-key" placeholder="xi-..." value="${_config.elevenlabs_api_key || ''}">
          <div class="form-hint">Get your API key from elevenlabs.io</div>
        </div>
        <div class="form-group">
          <label class="form-label">Model</label>
          <select class="form-input" id="tts-elevenlabs-model">
            <option value="eleven_multilingual_v2" ${_config.elevenlabs_model === 'eleven_multilingual_v2' ? 'selected' : ''}>Multilingual v2 (best quality)</option>
            <option value="eleven_turbo_v2_5" ${_config.elevenlabs_model === 'eleven_turbo_v2_5' ? 'selected' : ''}>Turbo v2.5 (fastest)</option>
            <option value="eleven_monolingual_v1" ${_config.elevenlabs_model === 'eleven_monolingual_v1' ? 'selected' : ''}>English v1</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Stability: <span id="tts-stability-val">${_config.stability.toFixed(2)}</span></label>
          <input type="range" class="form-range" id="tts-stability" min="0" max="1" step="0.05" value="${_config.stability}">
          <div class="form-hint">Lower = more expressive/variable, higher = more consistent</div>
        </div>
        <div class="form-group">
          <label class="form-label">Clarity + Similarity: <span id="tts-similarity-val">${_config.similarity_boost.toFixed(2)}</span></label>
          <input type="range" class="form-range" id="tts-similarity" min="0" max="1" step="0.05" value="${_config.similarity_boost}">
          <div class="form-hint">Higher = closer to original voice, lower = more creative</div>
        </div>
      </div>

      <!-- Language (Google only) -->
      <div class="form-group" id="tts-language-group" style="${isGoogle ? '' : 'display:none'}">
        <label class="form-label">Language</label>
        <select class="form-input" id="tts-language">
          ${LANGUAGES.map(l => `<option value="${l.code}" ${_config.language_code === l.code ? 'selected' : ''}>${l.label}</option>`).join('')}
        </select>
      </div>

      <!-- Voice -->
      <div class="form-group">
        <label class="form-label">Voice</label>
        <select class="form-input" id="tts-voice">
          ${voices.map(v => `<option value="${v.id}" ${_config.voice === v.id ? 'selected' : ''}>${v.label} (${v.gender})</option>`).join('')}
        </select>
      </div>

      <!-- Speed -->
      <div class="form-group">
        <label class="form-label">Speed: <span id="tts-speed-val">${_config.speed.toFixed(1)}x</span></label>
        <input type="range" class="form-range" id="tts-speed" min="0.5" max="2.0" step="0.1" value="${_config.speed}">
        <div class="form-hint">0.5x (slow) → 2.0x (fast)</div>
      </div>

      <!-- Auto-speak -->
      <div class="form-group">
        <label class="form-label toggle-label">
          <input type="checkbox" id="tts-auto-speak" ${_config.auto_speak ? 'checked' : ''}>
          <span>Auto-speak new responses</span>
        </label>
        <div class="form-hint">Automatically read aloud every new assistant message</div>
      </div>

      <!-- Actions -->
      <div class="form-group" style="display:flex;gap:12px;align-items:center">
        <button class="btn btn-primary" id="tts-save">Save</button>
        <button class="btn btn-ghost" id="tts-test">
          <span class="ms">volume_up</span> Test Voice
        </button>
      </div>

      <!-- Talk Mode section -->
      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
        <h3 style="margin:0 0 8px 0;font-size:14px;color:var(--text)">Talk Mode</h3>
        <p class="form-hint" style="margin:0 0 16px 0">Hold-to-talk or toggle continuous voice conversation. Your speech is transcribed via OpenAI Whisper, sent to your agent, and the response is read aloud automatically.</p>
        <div class="form-group" style="display:flex;gap:12px;align-items:center">
          <button class="btn btn-ghost" id="talk-mode-btn">
            <span class="ms">mic</span> Start Talk Mode
          </button>
          <span class="form-hint" id="talk-mode-status"></span>
        </div>
      </div>
    </div>
  `;

  // ── Event listeners ──

  const providerSelect = $('tts-provider') as HTMLSelectElement;
  providerSelect?.addEventListener('change', () => {
    const provider = providerSelect.value;
    const voiceSelect = $('tts-voice') as HTMLSelectElement;
    const langGroup = $('tts-language-group');
    const elGroup = $('tts-elevenlabs-group');
    const hint = $('tts-provider-hint');
    if (!voiceSelect) return;

    const voices = voicesForProvider(provider);
    voiceSelect.innerHTML = voices.map(v =>
      `<option value="${v.id}">${v.label} (${v.gender})</option>`
    ).join('');

    if (langGroup) langGroup.style.display = provider === 'google' ? '' : 'none';
    if (elGroup) elGroup.style.display = provider === 'elevenlabs' ? '' : 'none';
    if (hint) hint.textContent = providerHint(provider);
  });

  const speedSlider = $('tts-speed') as HTMLInputElement;
  const speedVal = $('tts-speed-val');
  speedSlider?.addEventListener('input', () => {
    if (speedVal) speedVal.textContent = `${parseFloat(speedSlider.value).toFixed(1)}x`;
  });

  // ElevenLabs sliders
  const stabilitySlider = $('tts-stability') as HTMLInputElement;
  const stabilityVal = $('tts-stability-val');
  stabilitySlider?.addEventListener('input', () => {
    if (stabilityVal) stabilityVal.textContent = parseFloat(stabilitySlider.value).toFixed(2);
  });

  const similaritySlider = $('tts-similarity') as HTMLInputElement;
  const similarityVal = $('tts-similarity-val');
  similaritySlider?.addEventListener('input', () => {
    if (similarityVal) similarityVal.textContent = parseFloat(similaritySlider.value).toFixed(2);
  });

  $('tts-save')?.addEventListener('click', async () => {
    _config = buildFormConfig();
    try {
      await pawEngine.ttsSetConfig(_config);
      showToast('Voice settings saved', 'success');
    } catch (e) {
      showToast('Failed to save: ' + (e instanceof Error ? e.message : e), 'error');
    }
  });

  $('tts-test')?.addEventListener('click', async () => {
    const btn = $('tts-test') as HTMLButtonElement;
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = `<span class="ms">hourglass_top</span> Generating...`;
    try {
      // Save current form state first
      _config = buildFormConfig();
      await pawEngine.ttsSetConfig(_config);
      const base64Audio = await pawEngine.ttsSpeak('Hello! I am your Pawz assistant. This is a test of the text to speech system.');
      const audioBytes = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
      const blob = new Blob([audioBytes], { type: 'audio/mp3' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url));
      audio.play();
      btn.innerHTML = `<span class="ms">volume_up</span> Test Voice`;
    } catch (e) {
      showToast('TTS test failed: ' + (e instanceof Error ? e.message : e), 'error');
      btn.innerHTML = `<span class="ms">volume_up</span> Test Voice`;
    } finally {
      btn.disabled = false;
    }
  });

  // ── Talk Mode ──
  $('talk-mode-btn')?.addEventListener('click', () => toggleTalkMode());
}

// ═══ Talk Mode ═══════════════════════════════════════════════════════════
// Continuous voice conversation: mic → Whisper STT → agent chat → TTS → speaker

let _talkModeActive = false;
let _mediaRecorder: MediaRecorder | null = null;
let _audioStream: MediaStream | null = null;
let _talkAudio: HTMLAudioElement | null = null;

async function toggleTalkMode() {
  if (_talkModeActive) {
    stopTalkMode();
  } else {
    await startTalkMode();
  }
}

async function startTalkMode() {
  const btn = $('talk-mode-btn') as HTMLButtonElement;
  const status = $('talk-mode-status');
  if (!btn) return;

  try {
    // Request microphone access
    _audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
    });

    _talkModeActive = true;
    btn.innerHTML = `<span class="ms">mic_off</span> Stop Talk Mode`;
    btn.classList.add('btn-danger');
    if (status) status.textContent = 'Listening...';

    // Start first recording cycle
    startRecordingCycle();
  } catch (e) {
    showToast('Microphone access denied — Talk Mode requires mic permission', 'error');
    console.error('[talk] Mic access error:', e);
  }
}

function stopTalkMode() {
  _talkModeActive = false;
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
  _mediaRecorder = null;
  if (_audioStream) {
    _audioStream.getTracks().forEach(t => t.stop());
    _audioStream = null;
  }
  if (_talkAudio) {
    _talkAudio.pause();
    _talkAudio = null;
  }
  const btn = $('talk-mode-btn') as HTMLButtonElement;
  const status = $('talk-mode-status');
  if (btn) {
    btn.innerHTML = `<span class="ms">mic</span> Start Talk Mode`;
    btn.classList.remove('btn-danger');
  }
  if (status) status.textContent = '';
}

function startRecordingCycle() {
  if (!_talkModeActive || !_audioStream) return;

  const status = $('talk-mode-status');

  // Detect supported MIME type
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/ogg';

  _mediaRecorder = new MediaRecorder(_audioStream, { mimeType });
  const chunks: Blob[] = [];

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  _mediaRecorder.onstop = async () => {
    if (!_talkModeActive) return;
    if (chunks.length === 0) { startRecordingCycle(); return; }

    const blob = new Blob(chunks, { type: mimeType });

    // Skip very short recordings (< 0.5s of data, ~8KB)
    if (blob.size < 8000) {
      if (status) status.textContent = 'Listening...';
      startRecordingCycle();
      return;
    }

    if (status) status.textContent = 'Transcribing...';

    try {
      // Convert blob to base64
      const base64 = await blobToBase64(blob);

      // Transcribe with Whisper
      const transcript = await pawEngine.ttsTranscribe(base64, mimeType);
      if (!transcript.trim()) {
        if (status) status.textContent = 'Listening...';
        startRecordingCycle();
        return;
      }

      if (status) status.textContent = `You: "${transcript.substring(0, 60)}${transcript.length > 60 ? '...' : ''}"`;

      // Send to agent via chat
      const { engineChatSend } = await import('../engine/molecules/bridge');
      const { appState } = await import('../state/index');
      const sessionKey = appState.currentSessionKey || 'default';
      const response = await engineChatSend(sessionKey, transcript);

      if (!_talkModeActive) return;

      // Extract response text
      const responseText = typeof response === 'string'
        ? response
        : (response as Record<string, unknown>)?.content as string || '';

      if (responseText && _talkModeActive) {
        if (status) status.textContent = 'Speaking...';
        // Speak the response
        try {
          const audioB64 = await pawEngine.ttsSpeak(responseText);
          const audioBytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
          const audioBlob = new Blob([audioBytes], { type: 'audio/mp3' });
          const url = URL.createObjectURL(audioBlob);
          _talkAudio = new Audio(url);
          _talkAudio.addEventListener('ended', () => {
            URL.revokeObjectURL(url);
            _talkAudio = null;
            if (_talkModeActive) {
              if (status) status.textContent = 'Listening...';
              startRecordingCycle();
            }
          });
          _talkAudio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            _talkAudio = null;
            if (_talkModeActive) startRecordingCycle();
          });
          _talkAudio.play();
          return; // Don't start next cycle until audio finishes
        } catch (e) {
          console.warn('[talk] TTS failed, continuing:', e);
        }
      }
    } catch (e) {
      console.error('[talk] Cycle error:', e);
      if (status) status.textContent = 'Error — retrying...';
    }

    // Start next recording cycle
    if (_talkModeActive) {
      setTimeout(() => startRecordingCycle(), 500);
    }
  };

  _mediaRecorder.start();

  // Record for 8 seconds, then process
  setTimeout(() => {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      _mediaRecorder.stop();
    }
  }, 8000);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix to get raw base64
      resolve(result.split(',')[1] || result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function initVoiceSettings() {
  // All dynamic — loaded when tab is opened
}
