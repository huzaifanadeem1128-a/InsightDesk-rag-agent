import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api";
import { Button } from "../lib/components";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await resetPassword(token, password);
      setSuccess(res.message);
      setTimeout(() => navigate("/login"), 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-view">
      <div className="auth-container">
        <div className="brand brand-centered">
          <div className="brand-icon">
            <svg viewBox="0 0 64 64" className="prism">
              <use href="#prism-symbol" />
            </svg>
          </div>
          <div>
            <div className="brand-name">InsightDesk</div>
            <div className="brand-subtitle">Set a new password</div>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-title">Choose a new password</div>
          <div className="auth-subtitle">
            Enter a new password for your account below.
          </div>

          {!token && (
            <div className="form-error">
              This reset link is missing its token. Please use the link from your
              email.
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <label className="field-label">New password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!token}
            />

            <label className="field-label">Confirm new password</label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={!token}
            />

            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success">{success}</div>}

            <Button primary block type="submit" disabled={busy || !token}>
              {busy ? "Resetting..." : "Reset password"}
            </Button>
          </form>

          <div className="auth-links">
            <Button block onClick={() => navigate("/login")}>
              Back to login
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}