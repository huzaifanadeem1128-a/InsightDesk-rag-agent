import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAdminUserDetail } from "../api";
import type { AdminUserDetail, AdminUserChat } from "../types";

export function AdminUserDetailPage() {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openChats, setOpenChats] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getAdminUserDetail(userId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleChat = (chatId: string) => {
    setOpenChats((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="admin-view">
        <div className="admin-layout">
          <div className="admin-empty">Loading user…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="admin-view">
        <div className="admin-layout">
          <div className="admin-empty">
            Failed to load user: {error || "Not found"}
          </div>
          <button
            className="btn"
            onClick={() => navigate("/admin")}
            style={{ marginTop: 16 }}
          >
            ← Back to admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-view">
      <div className="admin-layout">
        <div className="user-detail-header">
          <button
            type="button"
            className="user-detail-back"
            onClick={() => navigate("/admin")}
          >
            ← Back to admin
          </button>
          <h1 className="user-detail-email">{data.email}</h1>
          <div className="user-detail-meta">
            <span className={`admin-badge role-${data.role}`}>{data.role}</span>
            <span className="user-detail-joined">
              Member since {formatDate(data.created_at)}
            </span>
          </div>
        </div>

        <div className="user-detail-stats">
          <div className="user-detail-tile">
            <div className="user-detail-tile-value">
              {data.stats.total_chats}
            </div>
            <div className="user-detail-tile-label">Chats</div>
          </div>
          <div className="user-detail-tile">
            <div className="user-detail-tile-value">
              {data.stats.total_messages}
            </div>
            <div className="user-detail-tile-label">Messages</div>
          </div>
          <div className="user-detail-tile">
            <div className="user-detail-tile-value">
              {data.stats.total_questions}
            </div>
            <div className="user-detail-tile-label">Questions</div>
          </div>
          <div className="user-detail-tile">
            <div className="user-detail-tile-value">
              {data.stats.total_documents}
            </div>
            <div className="user-detail-tile-label">Documents</div>
          </div>
        </div>

        {/* Chats */}
        <div className="user-detail-section">
          <h2 className="user-detail-section-title">
            Chats ({data.chats.length})
          </h2>
          {data.chats.length === 0 ? (
            <div className="admin-empty">No chats yet.</div>
          ) : (
            <div className="user-detail-chat-list">
              {data.chats.map((chat) => (
                <ChatRow
                  key={chat.chat_id}
                  chat={chat}
                  open={openChats.has(chat.chat_id)}
                  onToggle={() => toggleChat(chat.chat_id)}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="user-detail-section">
          <h2 className="user-detail-section-title">
            Documents ({data.documents.length})
          </h2>
          {data.documents.length === 0 ? (
            <div className="admin-empty">No documents uploaded.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Chunks</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.document_id}>
                    <td>{d.name}</td>
                    <td>{d.chunks}</td>
                    <td className="admin-question-meta">
                      {formatDate(d.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatRow({
  chat,
  open,
  onToggle,
  formatDate,
}: {
  chat: AdminUserChat;
  open: boolean;
  onToggle: () => void;
  formatDate: (s: string) => string;
}) {
  return (
    <div className={"user-detail-chat" + (open ? " open" : "")}>
      <button
        type="button"
        className="user-detail-chat-header"
        onClick={onToggle}
      >
        <span className="user-detail-chat-arrow">{open ? "▾" : "▸"}</span>
        <span className="user-detail-chat-name">
          {chat.pinned && "📌 "}
          {chat.archived && "🔒 "}
          {chat.name}
        </span>
        <span className="user-detail-chat-meta">
          {chat.message_count} msg · {formatDate(chat.created_at)}
        </span>
      </button>

      {open && (
        <div className="user-detail-chat-body">
          {chat.messages.length === 0 ? (
            <div className="admin-empty">No messages.</div>
          ) : (
            chat.messages.map((m) => (
              <div
                key={m.message_id}
                className={"user-detail-msg user-detail-msg-" + m.role}
              >
                <div className="user-detail-msg-meta">
                  <span className="user-detail-msg-role">
                    {m.role === "user" ? "You" : "InsightDesk"}
                  </span>
                  <span className="user-detail-msg-time">
                    {formatDate(m.created_at)}
                  </span>
                </div>
                <div className="user-detail-msg-content">
                  {m.content.length > 2000
                    ? m.content.slice(0, 2000) + "…"
                    : m.content}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="user-detail-msg-sources">
                    {m.sources.length} source{m.sources.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}