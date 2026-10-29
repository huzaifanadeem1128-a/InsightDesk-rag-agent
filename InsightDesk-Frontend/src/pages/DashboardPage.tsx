import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../api";
import type { DashboardResponse } from "../types";

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDashboard()
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
  }, []);

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const formatRelative = (iso: string) => {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    const diff = Date.now() - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-container">
        <div className="dashboard-header">
          <button
            type="button"
            className="profile-back-btn"
            onClick={() => navigate("/workspace")}
          >
            ← Back to workspace
          </button>
          <h1 className="dashboard-title">Your Dashboard</h1>
          <p className="dashboard-subtitle">
            A quick overview of your workspace activity.
          </p>
        </div>

        {loading && <div className="profile-loading">Loading…</div>}

        {error && <div className="profile-msg-err">{error}</div>}

        {!loading && data && (
          <>
            <div className="dashboard-grid">
              <div className="dashboard-tile">
                <div className="dashboard-tile-icon">💬</div>
                <div className="dashboard-tile-value">
                  {data.stats.total_chats}
                </div>
                <div className="dashboard-tile-label">Chats</div>
              </div>
              <div className="dashboard-tile">
                <div className="dashboard-tile-icon">✉️</div>
                <div className="dashboard-tile-value">
                  {data.stats.total_messages}
                </div>
                <div className="dashboard-tile-label">Messages</div>
              </div>
              <div className="dashboard-tile">
                <div className="dashboard-tile-icon">❓</div>
                <div className="dashboard-tile-value">
                  {data.stats.total_questions}
                </div>
                <div className="dashboard-tile-label">Questions</div>
              </div>
              <div className="dashboard-tile">
                <div className="dashboard-tile-icon">📄</div>
                <div className="dashboard-tile-value">
                  {data.stats.total_documents}
                </div>
                <div className="dashboard-tile-label">Documents</div>
              </div>
            </div>

            <div className="dashboard-info-strip">
              <div className="dashboard-info-item">
                <span className="dashboard-info-label">Signed in as</span>
                <span className="dashboard-info-value">{data.email}</span>
              </div>
              <div className="dashboard-info-item">
                <span className="dashboard-info-label">Role</span>
                <span className="dashboard-info-value profile-role-badge">
                  {data.role}
                </span>
              </div>
              <div className="dashboard-info-item">
                <span className="dashboard-info-label">Member since</span>
                <span className="dashboard-info-value">
                  {formatDate(data.member_since)}
                </span>
              </div>
            </div>

            <div className="dashboard-usage">
              <h2 className="dashboard-section-title">Your usage</h2>
              <div className="dashboard-usage-grid">
                <div className="dashboard-usage-tile">
                  <div className="dashboard-usage-value">
                    {data.usage.messages_7d}
                  </div>
                  <div className="dashboard-usage-label">Messages (last 7 days)</div>
                </div>
                <div className="dashboard-usage-tile">
                  <div className="dashboard-usage-value">
                    {data.usage.questions_7d}
                  </div>
                  <div className="dashboard-usage-label">Questions (last 7 days)</div>
                </div>
                <div className="dashboard-usage-tile">
                  <div className="dashboard-usage-value">
                    {data.usage.estimated_tokens_total.toLocaleString()}
                  </div>
                  <div className="dashboard-usage-label">Est. tokens used</div>
                </div>
              </div>
              <div className="dashboard-usage-hint">
                Rate limit: 30 messages per minute. Estimated tokens assume ~4 chars per token.
              </div>
            </div>

            <div className="dashboard-recent">
              <h2 className="dashboard-section-title">Recent chats</h2>
              {data.recent_chats.length === 0 ? (
                <div className="dashboard-empty">
                  No chats yet. Start one in your workspace.
                </div>
              ) : (
                <div className="dashboard-recent-list">
                  {data.recent_chats.map((chat) => (
                    <button
                      key={chat.chat_id}
                      type="button"
                      className="dashboard-recent-item"
                      onClick={() => navigate("/workspace")}
                    >
                      <div className="dashboard-recent-main">
                        <span className="dashboard-recent-name">
                          {chat.archived && "🔒 "}
                          {chat.name}
                        </span>
                        <span className="dashboard-recent-meta">
                          {chat.message_count}{" "}
                          {chat.message_count === 1 ? "message" : "messages"}
                        </span>
                      </div>
                      <span className="dashboard-recent-time">
                        {formatRelative(chat.last_message_at)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

