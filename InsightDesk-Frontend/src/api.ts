/* ============================================================
   API CLIENT
   All backend calls go through this file.
   Dev: Vite proxy forwards /auth, /chat, /chats, /documents,
        /admin, /rag to http://127.0.0.1:8000 (see vite.config.ts)
   Prod: FastAPI serves the built frontend and API from the same origin.
   ============================================================ */

import type {
  AuthResponse,
  ChatDetail,
  ChatSummary,
  DocumentImpact,
  DocumentInfo,
  ProcessingInfo,
  RagStatus,
  AdminOverview,
  AdminRange,
  UserProfile,
  ChangeEmailResponse,
  ChangePasswordResponse,
  DeleteAccountResponse,
  ForgotPasswordResponse,
  ResetPasswordResponse,
  DashboardResponse,
} from "./types";

/* ============================================================
   AUTH STORAGE
   ============================================================ */

const STORAGE_KEY = "insightdesk_auth";

export interface StoredAuth {
  token: string;
  userId: string;
  email: string;
  role: string;
}

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {
    /* ignore */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ============================================================
   BASE REQUEST
   ============================================================ */

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  isForm?: boolean;
  auth?: boolean;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, isForm = false, auth = true } = options;

  const headers: Record<string, string> = {};
  if (auth) {
    const stored = loadAuth();
    if (stored?.token) headers["Authorization"] = `Bearer ${stored.token}`;
  }

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, { method, headers, body: payload });
  } catch {
    throw new Error("Cannot reach the backend. Is FastAPI running?");
  }

  if (response.status === 401 && auth) {
    clearAuth();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Session expired. Please log in again.");
  }

  let data: unknown = null;
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = { detail: await response.text() };
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const detail =
      (data as { detail?: unknown })?.detail || `HTTP ${response.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail)
    );
  }

  return data as T;
}

/* ============================================================
   AUTH
   ============================================================ */

export function getMyProfile() {
  return apiRequest<UserProfile>("/auth/me");
}

export function getDashboard() {
  return apiRequest<DashboardResponse>("/auth/dashboard");
}

export function changeEmail(newEmail: string, currentPassword: string) {
  return apiRequest<ChangeEmailResponse>("/auth/change-email", {
    method: "POST",
    body: { new_email: newEmail, current_password: currentPassword },
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest<ChangePasswordResponse>("/auth/change-password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

export function deleteAccount(currentPassword: string, confirmText: string) {
  return apiRequest<DeleteAccountResponse>("/auth/account", {
    method: "DELETE",
    body: { current_password: currentPassword, confirm_text: confirmText },
  });
}

export function login(email: string, password: string) {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    auth: false,
    body: { email, password },
  });
}

export function signup(email: string, password: string) {
  return apiRequest<{ message: string; user_id: string }>("/auth/signup", {
    method: "POST",
    auth: false,
    body: { email, password },
  });
}

export function logout() {
  return apiRequest<{ message: string }>("/auth/logout", {
    method: "POST",
  });
}

export function forgotPassword(email: string) {
  return apiRequest<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    auth: false,
    body: { email },
  });
}

export function resetPassword(token: string, newPassword: string) {
  return apiRequest<ResetPasswordResponse>("/auth/reset-password", {
    method: "POST",
    auth: false,
    body: { token, new_password: newPassword },
  });
}

/* ============================================================
   CHATS
   ============================================================ */

export function getChats() {
  return apiRequest<{ current_chat_id: string; chats: ChatSummary[] }>(
    "/chats"
  );
}

export function getSuggestions(chatId: string) {
  return apiRequest<{ suggestions: string[] }>(
    `/chats/${chatId}/suggestions`
  );
}

export function createChat(name = "New Chat") {
  return apiRequest<{ chat_id: string; name: string }>("/chats", {
    method: "POST",
    body: { name },
  });
}

export function getChat(chatId: string) {
  return apiRequest<ChatDetail>(`/chats/${chatId}`);
}

export function switchChat(chatId: string) {
  return apiRequest<{
    message: string;
    current_chat_id: string;
    messages: unknown[];
  }>(`/chats/${chatId}/switch`, { method: "POST" });
}

export function renameChat(chatId: string, name: string) {
  return apiRequest<{ message: string; chat_id: string; name: string }>(
    `/chats/${chatId}`,
    { method: "PUT", body: { name } }
  );
}

export function togglePinChat(chatId: string) {
  return apiRequest<{ chat_id: string; pinned: boolean }>(
    `/chats/${chatId}/pin`,
    { method: "POST" }
  );
}

export function deleteChat(chatId: string) {
  return apiRequest<{ message: string; current_chat_id: string }>(
    `/chats/${chatId}`,
    { method: "DELETE" }
  );
}

export function exportChatMarkdown(chatId: string) {
  return downloadFile(`/chats/${chatId}/export.md`);
}

export function exportChatPdf(chatId: string) {
  return downloadFile(`/chats/${chatId}/export.pdf`);
}

async function downloadFile(endpoint: string): Promise<void> {
  const stored = loadAuth();
  if (!stored?.token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${stored.token}`,
    },
  });

  if (response.status === 401) {
    clearAuth();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Session expired.");
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const disposition = response.headers.get("content-disposition") || "";
  const match =
    disposition.match(/filename\*=UTF-8''([^;]+)/i) ||
    disposition.match(/filename="?([^";]+)"?/i);
  const filename = match ? decodeURIComponent(match[1]) : "download";

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   DOCUMENTS
   ============================================================ */

export function getDocuments() {
  return apiRequest<{ documents: DocumentInfo[]; count: number }>(
    "/documents"
  );
}

export function uploadDocuments(
  files: File[],
  chunk_size: number,
  chunk_overlap: number,
  top_k: number
) {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  formData.append("chunk_size", String(chunk_size));
  formData.append("chunk_overlap", String(chunk_overlap));
  formData.append("top_k", String(top_k));

  return apiRequest<{
    message: string;
    processing_info: ProcessingInfo;
  }>("/documents", { method: "POST", body: formData, isForm: true });
}

export function documentImpact(documentId: string) {
  return apiRequest<DocumentImpact>(`/documents/${documentId}/impact`);
}

export function deleteDocument(documentId: string) {
  return apiRequest<{
    message: string;
    document_id: string;
    archived_chats: number;
  }>(`/documents/${documentId}`, { method: "DELETE" });
}

/* ============================================================
   RAG STATUS
   ============================================================ */

export function getRagStatus() {
  return apiRequest<RagStatus>("/rag/status");
}

/* ============================================================
   ADMIN
   ============================================================ */

export function getAdminOverview(range: AdminRange = "month") {
  return apiRequest<AdminOverview>(`/admin/overview?range=${range}`);
}

export function getAuditLog(limit = 100) {
  return apiRequest<import("./types").AuditLogResponse>(
    `/admin/audit?limit=${limit}`
  );
}

export function getAdminUserDetail(userId: string) {
  return apiRequest<import("./types").AdminUserDetail>(
    `/admin/users/${userId}`
  );
}

export function adminUserAction(
  userId: string,
  action: "promote" | "demote" | "ban" | "unban"
) {
  return apiRequest<{ message: string; user_id: string; role: string }>(
    `/admin/users/${userId}/${action}`,
    { method: "POST" }
  );
}

/* ============================================================
   CHAT STREAM (SSE over fetch)
   ============================================================ */

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onActivity: (activityType: string, message: string) => void;
  onSaved: (sources: import("./types").Source[], chatId?: string) => void;
  onTitle?: (chatId: string, name: string) => void;
  onError: (detail: string) => void;
  onDone: () => void;
}

export interface StreamRequest {
  chat_id: string;
  question: string;
  document_ids?: string[];
  regenerate?: boolean;
  image_data?: string;
}

export function streamChat(
  payload: StreamRequest,
  callbacks: StreamCallbacks
): { abort: () => void } {
  const controller = new AbortController();
  const stored = loadAuth();

  (async () => {
    try {
      const response = await fetch("/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(stored?.token
            ? { Authorization: `Bearer ${stored.token}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 401) {
        clearAuth();
        if (onUnauthorized) onUnauthorized();
        throw new Error("Session expired.");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleSSEFrame(frame, callbacks);
        }
      }

      callbacks.onDone();
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "AbortError") {
        callbacks.onDone();
        return;
      }
      callbacks.onError(e.message || "Unknown streaming error");
      callbacks.onDone();
    }
  })();

  return {
    abort: () => controller.abort(),
  };
}

function handleSSEFrame(frame: string, callbacks: StreamCallbacks): void {
  const lines = frame.split("\n");
  let eventName = "message";
  let dataLine = "";

  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }

  if (!dataLine) return;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return;
  }

  if (eventName === "token") {
    callbacks.onToken((payload.text as string) || "");
  } else if (eventName === "activity") {
    callbacks.onActivity(
      (payload.activity_type as string) || "activity",
      (payload.message as string) || ""
    );
  } else if (eventName === "title") {
    if (callbacks.onTitle) {
      callbacks.onTitle(
        (payload.chat_id as string) || "",
        (payload.name as string) || ""
      );
    }
  } else if (eventName === "done") {
    callbacks.onSaved(
      (payload.sources as import("./types").Source[]) || [],
      payload.chat_id as string | undefined
    );
  } else if (eventName === "error") {
    callbacks.onError((payload.detail as string) || "Unknown error");
  }
}

export function togglePinMessage(messageId: number) {
  return apiRequest<{ message_id: number; pinned: boolean }>(
    `/messages/${messageId}/pin`,
    { method: "POST" }
  );
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const stored = loadAuth();
  if (!stored?.token) {
    throw new Error("Not authenticated.");
  }

  const formData = new FormData();
  // Give the file a name so the backend / Groq see a proper extension.
  const ext = audioBlob.type.includes("mp4") ? "m4a" : "webm";
  formData.append("audio", audioBlob, `recording.${ext}`);

  const response = await fetch("/chat/transcribe", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stored.token}`,
    },
    body: formData,
  });

  if (response.status === 401) {
    clearAuth();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Session expired.");
  }

  let data: { text?: string; detail?: string } = {};
  try {
    data = await response.json();
  } catch {
    /* ignore */
  }

  if (!response.ok) {
    throw new Error(data.detail || `Transcription failed (${response.status}).`);
  }

  return (data.text || "").trim();
}

export async function extractImageText(imageFile: File): Promise<string> {
  const stored = loadAuth();
  if (!stored?.token) {
    throw new Error("Not authenticated.");
  }

  const formData = new FormData();
  formData.append("image", imageFile);

  const response = await fetch("/chat/extract-image-text", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stored.token}`,
    },
    body: formData,
  });

  if (response.status === 401) {
    clearAuth();
    if (onUnauthorized) onUnauthorized();
    throw new Error("Session expired.");
  }

  let data: { text?: string; detail?: string } = {};
  try {
    data = await response.json();
  } catch {
    /* ignore */
  }

  if (!response.ok) {
    throw new Error(data.detail || `Extraction failed (${response.status}).`);
  }

  return (data.text || "").trim();
}

