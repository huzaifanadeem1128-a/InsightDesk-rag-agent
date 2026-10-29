import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminUserAction, getAdminOverview, getAuditLog } from "../api";
import type { AdminOverview, AdminRange, AuditEntry } from "../types";
import { logout } from "../api";
import { useAuthStore } from "../store";

export function AdminPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [range, setRange] = useState<AdminRange>("month");
  const [tab, setTab] = useState<"users" | "documents" | "questions" | "health" | "system" | "audit">("users");
  const [error, setError] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "admin" | "banned">("all");
  const [pendingAction, setPendingAction] = useState<{
    userId: string;
    email: string;
    action: "promote" | "demote" | "ban" | "unban";
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async (r: AdminRange = range) => {
    try {
      const res = await getAdminOverview(r);
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (tab !== "audit" || auditEntries !== null) return;
    getAuditLog()
      .then((res) => setAuditEntries(res.entries))
      .catch((e) => alert((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const requestAction = (
    userId: string,
    email: string,
    action: "promote" | "demote" | "ban" | "unban"
  ) => {
    setActionError(null);
    setPendingAction({ userId, email, action });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await adminUserAction(pendingAction.userId, pendingAction.action);
      setPendingAction(null);
      load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const filteredUsers = (data?.users ?? []).filter((u) => {
    if (userFilter !== "all" && u.role !== userFilter) return false;
    if (userSearch.trim() && !u.email.toLowerCase().includes(userSearch.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  if (error) {
    return (
      <div className="admin-view">
        <div className="admin-layout">
          <div className="admin-empty">Failed to load: {error}</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="admin-view">
        <div className="admin-layout">
          <div className="admin-empty">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-view">
      <header className="top-header">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 64 64" className="prism">
              <use href="#prism-symbol" />
            </svg>
          </div>
          <div>
            <div className="brand-name">InsightDesk</div>
            <div className="brand-subtitle">Admin Panel</div>
          </div>
        </div>
        <div className="top-header-right">
          <span className="user-email">{useAuthStore.getState().email}</span>
          <button className="btn" onClick={() => navigate("/workspace")}>
            ← Back to chat
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await logout();
              } catch {
                /* ignore */
              }
              useAuthStore.getState().clearAuthState();
              navigate("/");
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <div className="admin-layout">
        <div className="admin-metrics">
          <Metric label="Total users" value={data.total_users} sub={`+${data.new_users_7d} this week`} />
          <Metric label="Conversations" value={data.total_conversations} sub={`${data.total_messages} messages`} />
          <Metric label="Documents" value={data.total_documents} sub={`${data.total_chunks} chunks indexed`} />
          <Metric label="Fallback rate" value={data.fallback_rate} sub="answers not found" />
          <Metric label="Active sessions" value={data.active_sessions} sub="right now" />
        </div>

        <div className="admin-chart-panel">
          <div className="admin-chart-header">
            <div className="admin-section-title">ACTIVITY</div>
            <div className="admin-range-buttons">
              {(["today", "week", "month"] as AdminRange[]).map((r) => (
                <button
                  key={r}
                  className={"admin-range-btn" + (r === range ? " active" : "")}
                  onClick={() => setRange(r)}
                >
                  {r === "today" ? "Today" : r === "week" ? "This week" : "Last 30 days"}
                </button>
              ))}
            </div>
          </div>
          <div className="admin-chart">
            <Chart buckets={data.activity} />
          </div>
        </div>

        <div className="admin-tabs">
          {(["users", "documents", "questions", "health", "system", "audit"] as const).map((t) => (
            <button
              key={t}
              className={"admin-tab" + (t === tab ? " active" : "")}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

          {tab === "users" && (
            <>
              <div className="admin-user-toolbar">
                <input
                  type="text"
                  className="admin-user-search"
                  placeholder="Search by email…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
                <div className="admin-user-filters">
                  {(["all", "admin", "banned"] as const).map((f) => (
                    <button
                      key={f}
                      className={
                        "admin-user-filter-btn" +
                        (userFilter === f ? " active" : "")
                      }
                      onClick={() => setUserFilter(f)}
                    >
                      {f === "all"
                        ? "All"
                        : f === "admin"
                        ? "Admins"
                        : "Banned"}
                    </button>
                  ))}
                </div>
              </div>

              {filteredUsers.length === 0 ? (
                <div className="admin-empty">No users match.</div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Chats</th>
                      <th>Docs</th>
                      <th>Questions</th>
                      <th>Joined</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.user_id}>
                        <td>
                          <button
                            type="button"
                            className="admin-user-link"
                            onClick={() => navigate(`/admin/users/${u.user_id}`)}
                            title="View user detail"
                          >
                            {u.email}
                          </button>
                        </td>
                        <td>
                          <span className={`admin-badge role-${u.role}`}>
                            {u.role}
                          </span>
                        </td>
                        <td>{u.chat_count}</td>
                        <td>{u.document_count}</td>
                        <td>{u.question_count}</td>
                        <td>{u.created_at ? u.created_at.slice(0, 10) : "-"}</td>
                        <td>
                          {u.role === "admin" && (
                            <button
                              className="admin-action"
                              onClick={() =>
                                requestAction(u.user_id, u.email, "demote")
                              }
                            >
                              Demote
                            </button>
                          )}
                          {u.role === "banned" && (
                            <button
                              className="admin-action"
                              onClick={() =>
                                requestAction(u.user_id, u.email, "unban")
                              }
                            >
                              Unban
                            </button>
                          )}
                          {u.role === "user" && (
                            <>
                              <button
                                className="admin-action"
                                onClick={() =>
                                  requestAction(u.user_id, u.email, "promote")
                                }
                              >
                                Promote
                              </button>
                              <button
                                className="admin-action danger"
                                onClick={() =>
                                  requestAction(u.user_id, u.email, "ban")
                                }
                              >
                                Ban
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === "documents" && (
            <table className="admin-table">
              <thead><tr><th>Document</th><th>Owner</th><th>Chunks</th><th>Uploaded</th></tr></thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.document_id}>
                    <td>{d.name}</td>
                    <td>{d.user_email}</td>
                    <td>{d.chunks}</td>
                    <td>{d.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "questions" && (
            <>
              <div className="metric-grid" style={{ marginBottom: 20 }}>
                <div className="metric">
                  <div className="metric-label">Total questions</div>
                  <div className="metric-value">{data.total_questions}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Last 7 days</div>
                  <div className="metric-value">{data.questions_7d}</div>
                </div>
              </div>
              <table className="admin-table">
                <thead><tr><th>Question</th><th>Asked by</th><th>When</th></tr></thead>
                <tbody>
                  {data.recent_questions.map((q, i) => (
                    <tr key={i}>
                      <td className="admin-question-cell">{q.content}</td>
                      <td className="admin-question-meta">{q.email}</td>
                      <td className="admin-question-meta">{q.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {tab === "health" && (
            <div className="health-panel">
              <div className="admin-section-title">RAG HEALTH</div>
              <div className="health-grid">
                <HealthTile label="Documents" value={data.total_documents} />
                <HealthTile label="Total chunks" value={data.health.total_chunks} />
                <HealthTile label="Avg chunks / doc" value={data.health.avg_chunks_per_doc} />
                <HealthTile label="Avg msgs / chat" value={data.health.avg_messages_per_chat} />
                <HealthTile label="Fallback rate" value={data.fallback_rate} />
                <HealthTile label="Memory entries" value={data.health.memory_entries} />
              </div>

              <div className="health-chart-header">
                <div className="admin-section-title">Fallback rate — last 30 days</div>
              </div>
              <div className="health-chart">
                <FallbackChart data={data.health.fallback_trend} />
              </div>
            </div>
          )}

          {tab === "system" && (
            <div className="system-services">
              <div className="system-title">RUNTIME</div>
              <div className="system-service"><span className="system-service-dot">●</span> LLM: {data.system.llm_model}</div>
              <div className="system-service"><span className="system-service-dot">●</span> Embeddings: {data.system.embedding_model}</div>
              <div className="system-service"><span className="system-service-dot">●</span> Uptime: {data.system.uptime}</div>
              <div className="system-service"><span className="system-service-dot">●</span> Active sessions: {data.system.active_sessions}</div>
            </div>
          )}
          {tab === "audit" && (
            auditEntries === null ? (
              <div className="admin-empty">Loading audit log…</div>
            ) : auditEntries.length === 0 ? (
              <div className="admin-empty">No admin actions recorded yet.</div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((e) => (
                    <tr key={e.id}>
                      <td className="admin-question-meta">{e.created_at}</td>
                      <td>{e.actor_email}</td>
                      <td>
                        <span className={`admin-badge action-${e.action}`}>
                          {e.action}
                        </span>
                      </td>
                      <td>{e.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      {pendingAction && (
        <div
          className="profile-modal-overlay"
          onClick={() => !actionBusy && setPendingAction(null)}
        >
          <div
            className="profile-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className={
                pendingAction.action === "ban"
                  ? "profile-modal-title danger"
                  : "profile-modal-title"
              }
            >
              {pendingAction.action === "promote" && "Promote this user?"}
              {pendingAction.action === "demote" && "Demote this user?"}
              {pendingAction.action === "ban" && "Ban this user?"}
              {pendingAction.action === "unban" && "Unban this user?"}
            </h3>

            <p className="profile-modal-text">
              <strong>{pendingAction.email}</strong>
              {pendingAction.action === "promote" &&
                " will gain full admin access, including the ability to manage users and view all data."}
              {pendingAction.action === "demote" && (
                <> will lose admin access and become a regular user. They can be promoted again at any time.</>
              )}
              {pendingAction.action === "ban" &&
                " will be immediately logged out and blocked from logging in again. Their data is preserved."}
              {pendingAction.action === "unban" &&
                " will regain the ability to log in. Their previous data remains intact."}
            </p>

            {actionError && <div className="profile-msg-err">{actionError}</div>}

            <div className="profile-modal-actions">
              <button
                type="button"
                className="profile-btn profile-btn-secondary"
                onClick={() => setPendingAction(null)}
                disabled={actionBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  pendingAction.action === "ban"
                    ? "profile-btn profile-btn-danger"
                    : "profile-btn profile-btn-primary"
                }
                onClick={confirmAction}
                disabled={actionBusy}
              >
                {actionBusy ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="admin-metric-card">
      <div className="admin-metric-label">{label}</div>
      <div className="admin-metric-value">{value}</div>
      <div className="admin-metric-sub">{sub}</div>
    </div>
  );
}

function Chart({ buckets }: { buckets: { label: string; signups: number; messages: number }[] }) {
  if (buckets.length === 0) {
    return <div className="admin-empty">No activity data.</div>;
  }

  const W = 900;
  const H = 200;
  const pad = { l: 30, r: 20, t: 20, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const maxVal = Math.max(1, ...buckets.map((d) => Math.max(d.signups, d.messages)));
  const stepX = buckets.length > 1 ? innerW / (buckets.length - 1) : 0;

  const path = (key: "signups" | "messages") =>
    buckets
      .map((d, i) => {
        const x = pad.l + i * stepX;
        const y = pad.t + innerH - (d[key] / maxVal) * innerH;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <line x1={pad.l} y1={pad.t + innerH} x2={W - pad.r} y2={pad.t + innerH} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      <path d={path("messages")} stroke="#7c5cff" strokeWidth={2} fill="none" />
      <path d={path("signups")} stroke="#5cc8ff" strokeWidth={2} fill="none" />
    </svg>
  );
}

function HealthTile({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="health-tile">
      <div className="health-tile-value">{value}</div>
      <div className="health-tile-label">{label}</div>
    </div>
  );
}

function FallbackChart({
  data,
}: {
  data: { label: string; rate: number; total: number; fallback: number }[];
}) {
  if (!data || data.length === 0) {
    return <div className="admin-empty">No data.</div>;
  }

  const W = 900;
  const H = 220;
  const pad = { l: 40, r: 20, t: 16, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const maxVal = Math.max(1, ...data.map((d) => d.rate));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const path = data
    .map((d, i) => {
      const x = pad.l + i * stepX;
      const y = pad.t + innerH - (d.rate / maxVal) * innerH;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
    >
      {/* axis */}
      <line
        x1={pad.l}
        y1={pad.t + innerH}
        x2={W - pad.r}
        y2={pad.t + innerH}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />

      {/* line */}
      <path
        d={path}
        stroke="#7c5cff"
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
      />

      {/* y-axis labels */}
      <text x={6} y={pad.t + 4} fill="#6a6e82" fontSize="10">
        {maxVal.toFixed(1)}%
      </text>
      <text x={6} y={pad.t + innerH + 4} fill="#6a6e82" fontSize="10">
        0%
      </text>
    </svg>
  );
}