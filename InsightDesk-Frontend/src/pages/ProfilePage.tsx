import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMyProfile,
  changeEmail,
  changePassword,
  deleteAccount,
} from "../api";
import { useAuthStore } from "../store";
import type { UserProfile } from "../types";

export function ProfilePage() {
  const navigate = useNavigate();
  const {
    email: storeEmail,
    role: storeRole,
    setAuth,
    token,
    userId,
    clearAuthState,
  } = useAuthStore();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Change email form
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Change password form
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
      })
      .catch((e) => {
        if (cancelled) return;
        alert((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailBusy) return;
    setEmailMsg(null);
    setEmailBusy(true);
    try {
      const res = await changeEmail(newEmail.trim(), emailPassword);
      setEmailMsg({ ok: true, text: res.message });
      setNewEmail("");
      setEmailPassword("");
      // Refresh profile
      const updated = await getMyProfile();
      setProfile(updated);
      // Keep store's email in sync.
      if (token && userId) {
        setAuth({
          token,
          userId,
          email: updated.email,
          role: updated.role,
        });
      }
    } catch (err) {
      setEmailMsg({ ok: false, text: (err as Error).message });
    } finally {
      setEmailBusy(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdBusy) return;
    setPwdMsg(null);

    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    if (newPwd.length < 6) {
      setPwdMsg({ ok: false, text: "Password must be at least 6 characters." });
      return;
    }

    setPwdBusy(true);
    try {
      const res = await changePassword(currentPwd, newPwd);
      setPwdMsg({ ok: true, text: res.message });
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (err) {
      setPwdMsg({ ok: false, text: (err as Error).message });
    } finally {
      setPwdBusy(false);
    }
  };

  const handleDelete = async () => {
    if (deleteBusy) return;
    setDeleteErr(null);

    if (deleteConfirm.trim() !== "DELETE") {
      setDeleteErr('You must type "DELETE" to confirm.');
      return;
    }

    setDeleteBusy(true);
    try {
      await deleteAccount(deletePassword, deleteConfirm);
      clearAuthState();
      navigate("/");
    } catch (err) {
      setDeleteErr((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const email = profile?.email ?? storeEmail ?? "";
  const role = profile?.role ?? storeRole;
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <div className="profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <button
            type="button"
            className="profile-back-btn"
            onClick={() => navigate("/workspace")}
          >
            ← Back to workspace
          </button>
          <h1 className="profile-title">Account Settings</h1>
        </div>

        {loading ? (
          <div className="profile-loading">Loading your profile…</div>
        ) : (
          <>
            {/* Read-only info */}
            <section className="profile-card">
              <h2 className="profile-section-title">Account</h2>
              <div className="profile-info-row">
                <span className="profile-info-label">Email</span>
                <span className="profile-info-value">{email}</span>
              </div>
              <div className="profile-info-row">
                <span className="profile-info-label">Role</span>
                <span className="profile-info-value profile-role-badge">
                  {role}
                </span>
              </div>
              <div className="profile-info-row">
                <span className="profile-info-label">Member since</span>
                <span className="profile-info-value">{memberSince}</span>
              </div>
            </section>

            {/* Change email */}
            <section className="profile-card">
              <h2 className="profile-section-title">Change email</h2>
              <form onSubmit={handleEmailSubmit} className="profile-form">
                <label className="profile-label">
                  New email
                  <input
                    type="email"
                    className="profile-input"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="profile-label">
                  Current password
                  <input
                    type="password"
                    className="profile-input"
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    required
                  />
                </label>
                {emailMsg && (
                  <div className={emailMsg.ok ? "profile-msg-ok" : "profile-msg-err"}>
                    {emailMsg.text}
                  </div>
                )}
                <button
                  type="submit"
                  className="profile-btn profile-btn-primary"
                  disabled={emailBusy}
                >
                  {emailBusy ? "Saving…" : "Update email"}
                </button>
              </form>
            </section>

            {/* Change password */}
            <section className="profile-card">
              <h2 className="profile-section-title">Change password</h2>
              <form onSubmit={handlePasswordSubmit} className="profile-form">
                <label className="profile-label">
                  Current password
                  <input
                    type="password"
                    className="profile-input"
                    value={currentPwd}
                    onChange={(e) => setCurrentPwd(e.target.value)}
                    required
                  />
                </label>
                <label className="profile-label">
                  New password
                  <input
                    type="password"
                    className="profile-input"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    required
                  />
                </label>
                <label className="profile-label">
                  Confirm new password
                  <input
                    type="password"
                    className="profile-input"
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    required
                  />
                </label>
                {pwdMsg && (
                  <div className={pwdMsg.ok ? "profile-msg-ok" : "profile-msg-err"}>
                    {pwdMsg.text}
                  </div>
                )}
                <button
                  type="submit"
                  className="profile-btn profile-btn-primary"
                  disabled={pwdBusy}
                >
                  {pwdBusy ? "Saving…" : "Update password"}
                </button>
              </form>
            </section>

            {/* Danger zone */}
            <section className="profile-card profile-danger-card">
              <p className="profile-danger-text">
                Deleting your account permanently removes your chats, documents,
                and messages. This cannot be undone.
              </p>
              <button
                type="button"
                className="profile-btn profile-btn-danger"
                onClick={() => {
                  setDeleteOpen(true);
                  setDeletePassword("");
                  setDeleteConfirm("");
                  setDeleteErr(null);
                }}
              >
                Delete account
              </button>
            </section>
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteOpen && (
        <div className="profile-modal-overlay" onClick={() => !deleteBusy && setDeleteOpen(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="profile-modal-title">Delete your account?</h3>
            <p className="profile-modal-text">
              This will permanently delete your account and all its data.
              Type <strong>DELETE</strong> and enter your password to confirm.
            </p>
            <label className="profile-label">
              Password
              <input
                type="password"
                className="profile-input"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoFocus
              />
            </label>
            <label className="profile-label">
              Type DELETE to confirm
              <input
                type="text"
                className="profile-input"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
              />
            </label>
            {deleteErr && <div className="profile-msg-err">{deleteErr}</div>}
            <div className="profile-modal-actions">
              <button
                type="button"
                className="profile-btn profile-btn-secondary"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="profile-btn profile-btn-danger"
                onClick={handleDelete}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}