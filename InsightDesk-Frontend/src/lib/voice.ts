/* ============================================================
   VOICE — Web Speech API
   ============================================================ */

const SOFT_VOICE_NAMES = [
  "samantha", "karen", "moira", "tessa", "fiona", "serena",
  "alex", "ava", "allie", "nathan", "evan", "noelle", "zoe", "tom",
  "google us english", "google uk english female", "google uk english male",
  "microsoft aria", "microsoft jenny", "microsoft guy", "microsoft davis",
  "microsoft zira", "microsoft hazel", "microsoft susan",
];

const NOVELTY_VOICE_NAMES = [
  "zarvox", "trinoids", "whisper", "bad news", "good news",
  "albert", "bahh", "boing", "bubbles", "cellos", "deranged",
  "hysterical", "junior", "organ", "princess", "ralph",
  "superstar", "wobble", "jester", "pipe organ", "fred",
  "bell", "bells",
];

export function classifyVoice(voice: SpeechSynthesisVoice): number {
  const name = (voice.name || "").toLowerCase();
  if (NOVELTY_VOICE_NAMES.some((n) => name.includes(n))) return 3;
  if (SOFT_VOICE_NAMES.some((n) => name.includes(n))) return 1;
  return 2;
}

export interface VoiceGroup {
  soft: SpeechSynthesisVoice[];
  neutral: SpeechSynthesisVoice[];
  novelty: SpeechSynthesisVoice[];
}

export function groupVoices(voices: SpeechSynthesisVoice[]): VoiceGroup {
  const englishFirst = [...voices].sort((a, b) => {
    const aEn = (a.lang || "").toLowerCase().startsWith("en");
    const bEn = (b.lang || "").toLowerCase().startsWith("en");
    if (aEn && !bEn) return -1;
    if (!aEn && bEn) return 1;
    return 0;
  });

  return {
    soft: englishFirst.filter((v) => classifyVoice(v) === 1),
    neutral: englishFirst.filter((v) => classifyVoice(v) === 2),
    novelty: englishFirst.filter((v) => classifyVoice(v) === 3),
  };
}

export interface SpeakOptions {
  text: string;
  voiceURI: string | null;
  rate: number;
  voices: SpeechSynthesisVoice[];
  onEnd: () => void;
  onStart?: () => void;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(opts: SpeakOptions): void {
  if (typeof speechSynthesis === "undefined") return;

  speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(opts.text);

  if (opts.voiceURI) {
    const v = opts.voices.find((x) => x.voiceURI === opts.voiceURI);
    if (v) u.voice = v;
  }
  u.rate = opts.rate;

  u.onend = () => {
    currentUtterance = null;
    opts.onEnd();
  };
  u.onerror = () => {
    currentUtterance = null;
    opts.onEnd();
  };

  currentUtterance = u;
  if (opts.onStart) opts.onStart();
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
    currentUtterance = null;
  }
}

export function hasCurrentUtterance(): boolean {
  return currentUtterance !== null;
}

/* ============================================================
   SENTENCE SPLITTING (for highlighting during TTS)
   ============================================================ */

/**
 * Split text into sentences. Preserves sentence boundaries
 * reasonably well for English prose and markdown-stripped text.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text) return [];

  // Normalize whitespace.
  const normalized = text.replace(/\s+/g, " ").trim();

  // Split on sentence-ending punctuation followed by space or end.
  // Handles ".", "!", "?", optionally followed by closing quotes.
  const parts = normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|\S[^.!?]*$/g);

  if (!parts) return [normalized];

  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}