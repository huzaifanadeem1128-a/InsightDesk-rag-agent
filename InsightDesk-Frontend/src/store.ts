/* ============================================================
   GLOBAL STATE — zustand
   ============================================================ */

import { create } from "zustand";
import {
  clearAuth,
  loadAuth,
  saveAuth,
} from "./api";
import type {
  ChatSummary,
  DocumentInfo,
  Message,
  ProcessingInfo,
  RagStatus,
  Role,
} from "./types";

/* ============================================================
   AUTH SLICE
   ============================================================ */

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  role: Role;

  setAuth: (params: {
    token: string;
    userId: string;
    email: string;
    role: Role;
  }) => void;
  clearAuthState: () => void;
  hydrateFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  email: null,
  role: "user",

  setAuth: ({ token, userId, email, role }) => {
    saveAuth({ token, userId, email, role });
    set({ token, userId, email, role });
  },

  clearAuthState: () => {
    clearAuth();
    set({ token: null, userId: null, email: null, role: "user" });
  },

  hydrateFromStorage: () => {
    const stored = loadAuth();
    if (stored) {
      set({
        token: stored.token,
        userId: stored.userId,
        email: stored.email,
        role: (stored.role as Role) || "user",
      });
    }
  },
}));

/* ============================================================
   CHATS + WORKSPACE SLICE
   ============================================================ */

interface ChatsState {
  chats: ChatSummary[];
  currentChatId: string | null;
  currentChatArchived: boolean;
  messages: Message[];
  chatTitle: string;

  setChats: (chats: ChatSummary[]) => void;
  setCurrentChat: (chatId: string | null) => void;
  setCurrentChatArchived: (archived: boolean) => void;
  setMessages: (messages: Message[]) => void;
  appendMessage: (message: Message) => void;
  updateLastMessage: (patch: Partial<Message>) => void;
  setChatTitle: (title: string) => void;
  reset: () => void;
}

export const useChatsStore = create<ChatsState>((set) => ({
  chats: [],
  currentChatId: null,
  currentChatArchived: false,
  messages: [],
  chatTitle: "InsightDesk",

  setChats: (chats) => set({ chats }),
  setCurrentChat: (chatId) => set({ currentChatId: chatId }),
  setCurrentChatArchived: (archived) =>
    set({ currentChatArchived: archived }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  updateLastMessage: (patch) =>
    set((s) => {
      if (s.messages.length === 0) return s;
      const copy = [...s.messages];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { ...last, ...patch };
      return { messages: copy };
    }),
  setChatTitle: (title) => set({ chatTitle: title }),
  reset: () =>
    set({
      chats: [],
      currentChatId: null,
      currentChatArchived: false,
      messages: [],
      chatTitle: "InsightDesk",
    }),
}));

/* ============================================================
   DOCUMENTS + WORKSPACE SETTINGS SLICE
   ============================================================ */

interface DocsState {
  documents: DocumentInfo[];
  selectedDocumentIds: string[];
  processingInfo: ProcessingInfo | null;
  status: RagStatus | null;

  chunkSize: number;
  chunkOverlap: number;
  topK: number;

  setDocuments: (docs: DocumentInfo[]) => void;
  setSelectedDocumentIds: (ids: string[]) => void;
  toggleDocumentSelection: (id: string) => void;
  setProcessingInfo: (info: ProcessingInfo | null) => void;
  setStatus: (status: RagStatus | null) => void;
  setRetrieval: (params: {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
  }) => void;
  reset: () => void;
}

export const useDocsStore = create<DocsState>((set) => ({
  documents: [],
  selectedDocumentIds: [],
  processingInfo: null,
  status: null,

  chunkSize: 800,
  chunkOverlap: 150,
  topK: 4,

  setDocuments: (documents) => set({ documents }),
  setSelectedDocumentIds: (selectedDocumentIds) =>
    set({ selectedDocumentIds }),
  toggleDocumentSelection: (id) =>
    set((s) => {
      const has = s.selectedDocumentIds.includes(id);
      return {
        selectedDocumentIds: has
          ? s.selectedDocumentIds.filter((x) => x !== id)
          : [...s.selectedDocumentIds, id],
      };
    }),
  setProcessingInfo: (processingInfo) => set({ processingInfo }),
  setStatus: (status) =>
    set({
      status,
      chunkSize: status?.chunk_size ?? 800,
      chunkOverlap: status?.chunk_overlap ?? 150,
      topK: status?.top_k ?? 4,
    }),
  setRetrieval: ({ chunkSize, chunkOverlap, topK }) =>
    set({ chunkSize, chunkOverlap, topK }),
  reset: () =>
    set({
      documents: [],
      selectedDocumentIds: [],
      processingInfo: null,
      status: null,
      chunkSize: 800,
      chunkOverlap: 150,
      topK: 4,
    }),
}));

/* ============================================================
   STREAMING SLICE
   ============================================================ */

interface StreamState {
  streaming: boolean;
  abortFn: (() => void) | null;

  startStream: (abortFn: () => void) => void;
  endStream: () => void;
  abort: () => void;
}

export const useStreamStore = create<StreamState>((set, get) => ({
  streaming: false,
  abortFn: null,

  startStream: (abortFn) => set({ streaming: true, abortFn }),
  endStream: () => set({ streaming: false, abortFn: null }),
  abort: () => {
    const fn = get().abortFn;
    if (fn) fn();
  },
}));

/* ============================================================
   VOICE SLICE
   ============================================================ */

const VOICE_KEY = "insightdesk_voice";

interface VoiceState {
  selectedVoiceURI: string | null;
  voiceRate: number;
  currentlySpeakingId: number | null;
  lastSpokenText: string | null;
  lastSpokenMessageIndex: number | null;

  setVoice: (voiceURI: string | null) => void;
  setRate: (rate: number) => void;
  setCurrentlySpeaking: (idx: number | null) => void;
  setLastSpoken: (text: string | null, messageIndex: number | null) => void;
  hydrateFromStorage: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  selectedVoiceURI: null,
  voiceRate: 1.0,
  currentlySpeakingId: null,
  lastSpokenText: null,
  lastSpokenMessageIndex: null,

  setVoice: (voiceURI) => {
    set({ selectedVoiceURI: voiceURI });
    persistVoice({ voiceURI });
  },
  setRate: (rate) => {
    set({ voiceRate: rate });
    persistVoice({ rate });
  },
  setCurrentlySpeaking: (idx) => set({ currentlySpeakingId: idx }),
  setLastSpoken: (text, messageIndex) =>
    set({ lastSpokenText: text, lastSpokenMessageIndex: messageIndex }),
  hydrateFromStorage: () => {
    try {
      const raw = localStorage.getItem(VOICE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      set({
        selectedVoiceURI: parsed.voiceURI ?? null,
        voiceRate: parsed.rate ?? 1.0,
      });
    } catch {
      /* ignore */
    }
  },
}));

function persistVoice(patch: {
  voiceURI?: string | null;
  rate?: number;
}): void {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    const next = { ...current, ...patch };
    localStorage.setItem(VOICE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/* ============================================================
   UI STATE — sidebar visibility
   ============================================================ */

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () =>
    set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));