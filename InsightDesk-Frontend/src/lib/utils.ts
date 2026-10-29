import { marked } from "marked";
import DOMPurify from "dompurify";
export function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isErrorContent(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = String(text).trim();
  if (trimmed.startsWith("Error:")) return true;
  if (trimmed.startsWith("_Error:")) return true;
  if (trimmed.startsWith("_(")) return true;
  if (trimmed.includes("was flagged as")) return true;
  if (trimmed.includes("contains abusive language")) return true;
  return false;
}

export function stripMarkdown(text: string | undefined): string {
  if (!text) return "";
  let s = String(text);

  s = s.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, " ");
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, " ");
  s = s.replace(/&gt;/g, " ");
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");

  s = s.replace(/([A-Za-z0-9])_([A-Za-z0-9])/g, "$1 $2");

  s = s.replace(/^\s*\|.*\|\s*$/gm, (row) => {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(row)) return "";
    return row.replace(/\|/g, " ").trim();
  });

  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/\*(.+?)\*/g, "$1");
  s = s.replace(/___(.+?)___/g, "$1");
  s = s.replace(/__(.+?)__/g, "$1");
  s = s.replace(/_(.+?)_/g, "$1");
  s = s.replace(/~~(.+?)~~/g, "$1");

  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/^\s*#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*(\d+)\.\s+/gm, "$1, ");
  s = s.replace(/^\s*>\s?/gm, "");
  s = s.replace(/^\s*[-*_]{3,}\s*$/gm, "");

  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

const TTS_ACRONYMS: Record<string, string> = {
  HR: "H R", IT: "I T", AI: "A I", US: "U S", UK: "U K", EU: "E U",
  API: "A P I", CEO: "C E O", CFO: "C F O", CTO: "C T O",
  HRIS: "H R I S", PTO: "P T O", ID: "I D", URL: "U R L", PDF: "P D F",
};

export function expandAcronymsForSpeech(text: string | undefined): string {
  if (!text) return "";
  let s = String(text);
  for (const [acronym, spoken] of Object.entries(TTS_ACRONYMS)) {
    const pattern = new RegExp(`\\b${acronym}\\b`, "g");
    s = s.replace(pattern, spoken);
  }
  return s;
}

export function renderMarkdown(text: string | undefined): string {
  if (!text) return "";
  try {
    const raw = marked.parse(text, { breaks: true, gfm: true }) as string;
    return DOMPurify.sanitize(raw);
  } catch {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
}

export type Confidence = "high" | "medium" | "low" | "none";

export interface ConfidenceResult {
  level: Confidence;
  label: string;
  avg: number | null;
}

export function computeConfidence(
  sources: { relevance_score?: number }[] | undefined
): ConfidenceResult {
  if (!sources || sources.length === 0) {
    return { level: "none", label: "N/A", avg: null };
  }

  const scores = sources
    .map((s) => s.relevance_score)
    .filter((s): s is number => typeof s === "number");

  if (scores.length === 0) {
    return { level: "none", label: "N/A", avg: null };
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Semantic similarity scores from Chroma tend to be lower than
  // lexical overlap scores. Recalibrated for the semantic scale.
  if (avg >= 0.35) return { level: "high", label: "High", avg };
  if (avg >= 0.20) return { level: "medium", label: "Medium", avg };
  return { level: "low", label: "Low", avg };
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - then) / 1000));

    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;

    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export function formatExactTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}