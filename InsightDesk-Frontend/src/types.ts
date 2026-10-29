/* ============================================================
   API TYPES
   ============================================================ */

export type Role = "user" | "admin" | "banned";

export interface AuthResponse {
  message: string;
  token: string;
  user_id: string;
  email: string;
  role: Role;
}

export interface ChatSummary {
  chat_id: string;
  name: string;
  archived: boolean;
  pinned: boolean;
  message_count: number;
}

export interface Source {
  document_id?: string;
  source?: string;
  page?: number | string;
  relevance_score?: number;
}

export interface ActivityEvent {
  type: string;
  message: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  activity?: ActivityEvent[];
  message_id?: number;
  created_at?: string;
  pinned?: boolean;
  image_data?: string;
}

export interface ChatDetail {
  chat_id: string;
  name: string;
  archived: boolean;
  messages: Message[];
  is_current: boolean;
}

export interface DocumentInfo {
  document_id: string;
  name: string;
}

export interface RagStatus {
  documents: string[];
  document_count: number;
  chat_count: number;
  current_chat_id: string | null;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  llm_model: string;
  embedding_model: string;
}

export interface ProcessingInfo {
  document_count: number;
  chunk_count: number;
  embedding_dimension: number | string;
  embedding_model: string;
  llm_model: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  document_names: string[];
  document_ids: string[];
  document_map: Record<string, string>;
  skipped_documents?: string[];
}

export interface DocumentImpact {
  document_id: string;
  document_name: string;
  affected_chats: number;
  already_archived: number;
  chats: { chat_id: string; name: string; archived: boolean }[];
}

export interface UserProfile {
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface ChangeEmailResponse {
  message: string;
  email: string;
}

export interface ChangePasswordResponse {
  message: string;
}

export interface DeleteAccountResponse {
  message: string;
  deleted: Record<string, number>;
}

/* ============================================================
   ADMIN TYPES
   ============================================================ */

export interface AdminUserRow {
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
  chat_count: number;
  document_count: number;
  question_count: number;
}

export interface AdminDocumentRow {
  document_id: string;
  name: string;
  created_at: string;
  user_id: string;
  user_email: string;
  chunks: number | string;
}

export interface AdminQuestionRow {
  content: string;
  created_at: string;
  email: string;
}

export interface AdminActivityBucket {
  label: string;
  signups: number;
  messages: number;
}

export interface AdminOverview {
  range: "today" | "week" | "month";
  total_users: number;
  new_users_7d: number;
  total_conversations: number;
  total_messages: number;
  total_documents: number;
  total_chunks: number | string;
  fallback_rate: string;
  active_sessions: number;
  activity: AdminActivityBucket[];
  users: AdminUserRow[];
  documents: AdminDocumentRow[];
  recent_questions: AdminQuestionRow[];
  total_questions: number;
  questions_7d: number;
  system: {
    llm_model: string;
    embedding_model: string;
    uptime: string;
    active_sessions: number;
  };
  health: {
    total_chunks: number;
    avg_chunks_per_doc: number;
    avg_messages_per_chat: number;
    memory_entries: number;
    fallback_trend: {
      label: string;
      rate: number;
      total: number;
      fallback: number;
    }[];
  };
}

export type AdminRange = "today" | "week" | "month";

/* ============================================================
   STREAMING TYPES (SSE)
   ============================================================ */

export interface StreamTokenEvent {
  type: "token";
  text: string;
}

export interface StreamActivityEvent {
  type: "activity";
  activity_type: string;
  message: string;
}

export interface StreamSavedEvent {
  type: "saved";
  sources: Source[];
  chat_id?: string;
}

export interface StreamErrorEvent {
  type: "error";
  detail: string;
}

export type StreamEvent =
  | StreamTokenEvent
  | StreamActivityEvent
  | StreamSavedEvent
  | StreamErrorEvent;

/* ============================================================
   VOICE TYPES
   ============================================================ */

export interface VoicePreference {
  voiceURI: string | null;
  rate: number;
}

/* ============================================================
   DASHBOARD TYPES
   ============================================================ */

export interface DashboardStats {
  total_chats: number;
  total_messages: number;
  total_questions: number;
  total_documents: number;
}

export interface DashboardRecentChat {
  chat_id: string;
  name: string;
  message_count: number;
  archived: boolean;
  last_message_at: string;
}

export interface DashboardUsage {
  messages_7d: number;
  questions_7d: number;
  estimated_tokens_total: number;
}

export interface DashboardResponse {
  user_id: string;
  email: string;
  role: Role;
  member_since: string;
  stats: DashboardStats;
  usage: DashboardUsage;
  recent_chats: DashboardRecentChat[];
}

/* ============================================================
   PASSWORD RESET TYPES
   ============================================================ */

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_email: string;
  action: string;
  target: string;
  details: string | null;
}

export interface AuditLogResponse {
  entries: AuditEntry[];
}

/* ============================================================
   ADMIN USER DETAIL
   ============================================================ */

export interface AdminUserMessage {
  message_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  pinned: boolean;
  sources?: unknown[];
  has_image?: boolean;
}

export interface AdminUserChat {
  chat_id: string;
  name: string;
  created_at: string;
  archived: boolean;
  pinned: boolean;
  message_count: number;
  messages: AdminUserMessage[];
}

export interface AdminUserDocument {
  document_id: string;
  name: string;
  created_at: string;
  chunks: number;
}

export interface AdminUserDetail {
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
  stats: {
    total_chats: number;
    total_messages: number;
    total_questions: number;
    total_documents: number;
  };
  chats: AdminUserChat[];
  documents: AdminUserDocument[];
}