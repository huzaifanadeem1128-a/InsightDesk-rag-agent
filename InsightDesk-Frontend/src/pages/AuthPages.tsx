import { useState, type ReactNode } from "react";
import { forgotPassword, login, signup } from "../api";
import { useAuthStore } from "../store";
import { Button } from "../lib/components";
import { CornerBot } from "../components/CornerBot";

interface Props {
  initialPanel?: "login" | "signup" | "forgot";
  onSuccess: () => void;
  onBackToLanding: () => void;
}

export function AuthPages({ initialPanel = "login", onSuccess, onBackToLanding }: Props) {
  const [panel, setPanel] = useState(initialPanel);
  const { setAuth } = useAuthStore();

  return (
    <div className="auth-view">
      <div className="auth-bg">
        <AuthCanvas />
        <div className="auth-prism-ghost">
          <svg viewBox="0 0 64 64">
            <use href="#prism-symbol" />
          </svg>
        </div>
        <div className="auth-noise" />
      </div>

      <div className="auth-container">
        <div className="brand brand-centered">
          <div className="brand-icon">
            <svg viewBox="0 0 64 64" className="prism">
              <use href="#prism-symbol" />
            </svg>
          </div>
          <div>
            <div className="brand-name">InsightDesk</div>
            <div className="brand-subtitle">Intelligent document workspace</div>
          </div>
        </div>

        {panel === "login" && (
          <LoginPanel
            onSuccess={(payload) => {
              setAuth(payload);
              onSuccess();
            }}
            onGotoSignup={() => setPanel("signup")}
            onGotoForgot={() => setPanel("forgot")}
            onBack={onBackToLanding}
          />
        )}

        {panel === "signup" && (
          <SignupPanel
            onGotoLogin={() => setPanel("login")}
          />
        )}

        {panel === "forgot" && (
          <ForgotPanel onGotoLogin={() => setPanel("login")} />
        )}
      </div>

      <CornerBot />
    </div>
  );
}

/* ============================================================
   LOGIN
   ============================================================ */

function LoginPanel({
  onSuccess,
  onGotoSignup,
  onGotoForgot,
  onBack,
}: {
  onSuccess: (p: {
    token: string;
    userId: string;
    email: string;
    role: "user" | "admin" | "banned";
  }) => void;
  onGotoSignup: () => void;
  onGotoForgot: () => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      onSuccess({
        token: res.token,
        userId: res.user_id,
        email: res.email,
        role: res.role,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-title">Welcome back</div>
      <div className="auth-subtitle">Log in to access your workspace</div>

      <form onSubmit={handleSubmit}>
        <label className="field-label">Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="field-label">Password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <div className="form-error">{error}</div>}

        <Button primary block type="submit" disabled={busy}>
          {busy ? "Logging in..." : "Log in"}
        </Button>
      </form>

      <div className="auth-links">
        <Button block onClick={onGotoSignup}>
          Create an account
        </Button>
        <Button block onClick={onGotoForgot}>
          Forgot password?
        </Button>
        <Button block onClick={onBack}>
          ← Back to home
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   SIGNUP
   ============================================================ */

function SignupPanel({ onGotoLogin }: { onGotoLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setBusy(true);
    try {
      await signup(email.trim(), password);
      setSuccess("Account created. You can now log in.");
      setTimeout(onGotoLogin, 900);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-title">Create your account</div>
      <div className="auth-subtitle">
        Just your email and a password — that's it.
      </div>

      <form onSubmit={handleSubmit}>
        <label className="field-label">Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="field-label">Password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label className="field-label">Confirm password</label>
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        <Button primary block type="submit" disabled={busy}>
          {busy ? "Creating account..." : "Sign up"}
        </Button>
      </form>

      <div className="auth-links">
        <Button block onClick={onGotoLogin}>
          Already have an account? Log in
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   FORGOT PASSWORD
   ============================================================ */

function ForgotPanel({ onGotoLogin }: { onGotoLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    setBusy(true);
    try {
      const res = await forgotPassword(email.trim());
      setSuccess(res.message);
      setEmail("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-title">Reset your password</div>
      <div className="auth-subtitle">
        We'll email you a link to set a new password.
      </div>

      <form onSubmit={handleSubmit}>
        <label className="field-label">Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        <Button primary block type="submit" disabled={busy}>
          {busy ? "Sending..." : "Send reset link"}
        </Button>
      </form>

      <div className="auth-links">
        <Button block onClick={onGotoLogin}>
          Back to login
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   INLINE HELPERS (canvas + bot inside auth view)
   ============================================================ */

function AuthCanvas() {
  const ref = (el: HTMLCanvasElement | null) => {
    if (!el) return;
    const canvas = el;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const orbs = [
      { x: W * 0.2, y: H * 0.25, r: 340, vx: 0.18, vy: 0.12, hue: 268, pulse: 0 },
      { x: W * 0.78, y: H * 0.72, r: 400, vx: -0.14, vy: -0.16, hue: 220, pulse: 1.1 },
      { x: W * 0.55, y: H * 0.5, r: 300, vx: 0.1, vy: 0.15, hue: 195, pulse: 2.2 },
    ];

    let t = 0;
    let raf = 0;

    const onResize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    const frame = () => {
      t += 0.005;
      ctx.clearRect(0, 0, W, H);
      for (const orb of orbs) {
        orb.x += orb.vx;
        orb.y += orb.vy;
        const pad = orb.r * 0.6;
        if (orb.x < -pad) orb.x = W + pad;
        if (orb.x > W + pad) orb.x = -pad;
        if (orb.y < -pad) orb.y = H + pad;
        if (orb.y > H + pad) orb.y = -pad;

        const pulse = Math.sin(t + orb.pulse) * 0.15 + 1;
        const grd = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r * pulse);
        grd.addColorStop(0, `hsla(${orb.hue}, 100%, 68%, 0.28)`);
        grd.addColorStop(0.4, `hsla(${orb.hue}, 100%, 60%, 0.14)`);
        grd.addColorStop(1, `hsla(${orb.hue}, 100%, 55%, 0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.r * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < 24; i++) {
        const px = Math.abs((Math.sin(i * 12.9898 + t * 0.8) * 43758.5453) % 1);
        const py = Math.abs((Math.sin(i * 78.233 + t * 0.6) * 43758.5453) % 1);
        const x = px * W;
        const y = py * H;
        const r = 1.2 + Math.abs(Math.sin(t * 2 + i)) * 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${240 + (i % 60)}, 90%, 78%, 0.55)`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  };

  return <canvas id="auth-canvas" className="auth-canvas" ref={ref} />;
}

export function AuthBackdrop({ children }: { children: ReactNode }) {
  return <div className="auth-view">{children}</div>;
}