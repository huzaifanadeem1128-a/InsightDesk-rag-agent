import { useNavigate } from "react-router-dom";

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-view">
      <LandingCanvas />
      <header className="landing-header">
        <div className="brand">
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
        <div className="landing-header-actions">
          <button className="btn" onClick={() => navigate("/login")}>Log in</button>
          <button className="btn btn-primary" onClick={() => navigate("/signup")}>Get started</button>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-content">
            <div className="landing-eyebrow">AI-POWERED DOCUMENT INTELLIGENCE</div>
            <h1 className="landing-title">
              Your documents.<br />Your data.<br />
              <span className="landing-title-accent">Real answers.</span>
            </h1>
            <p className="landing-subtitle">
              Upload PDFs, ask questions in plain English, and get grounded
              answers with citations you can verify — powered by an AI agent
              that reasons through your documents, not around them.
            </p>
            <div className="landing-cta">
              <button className="btn btn-primary btn-lg" onClick={() => navigate("/signup")}>
                Get started free
              </button>
              <button className="btn btn-lg" onClick={() => navigate("/login")}>
                Log in
              </button>
            </div>
          </div>
          <div className="landing-hero-visual">
            <div className="landing-prism-large">
              <svg viewBox="0 0 64 64" className="prism-xl">
                <use href="#prism-symbol" />
              </svg>
            </div>
          </div>
        </section>

        <div className="landing-stat-strip">
          <div className="landing-stat">
            <span className="landing-stat-icon">⛨</span>
            <span>Private by default</span>
          </div>
          <span className="landing-stat-sep">·</span>
          <div className="landing-stat">
            <span className="landing-stat-icon">◆</span>
            <span>Your data stays yours</span>
          </div>
          <span className="landing-stat-sep">·</span>
          <div className="landing-stat">
            <span className="landing-stat-icon">✕</span>
            <span>No training on your documents</span>
          </div>
        </div>

        <section className="landing-section">
          <div className="landing-section-eyebrow">WHY INSIGHTDESK</div>
          <h2 className="landing-section-title">Built different. On purpose.</h2>
          <div className="landing-features">
            <Feature icon="◆" title="Grounded, not guessed" body="Every answer cites the exact document and page it came from. No hallucinated facts." />
            <Feature icon="◎" title="Reasons before it answers" body="InsightDesk plans its approach before responding. Ask it to compare two contracts — it reads both." />
            <Feature icon="↻" title="Remembers your conversations" body="Continuity across sessions. Ask 'what did we discuss last week?' and it knows." />
            <Feature icon="⛨" title="Private by default" body="Your documents, your embeddings, your data. Nothing leaves your infrastructure." />
            <Feature icon="♪" title="Voice-ready" body="Prefer to listen? Every answer plays back in a voice of your choice." />
            <Feature icon="◇" title="Built for teams" body="Multi-user, per-document permissions, session-based auth." />
          </div>
        </section>

                <section className="landing-section">
          <div className="landing-section-eyebrow">HOW IT WORKS</div>
          <h2 className="landing-section-title">From document to insight in seconds.</h2>
          <div className="landing-steps">
            <Step
              number="01"
              title="Upload"
              body="Drop your PDFs and TXTs. We chunk, embed, and index them in seconds."
            />
            <Step
              number="02"
              title="Ask"
              body="Type a question. The agent plans its search, retrieves relevant chunks, and reasons through the answer."
            />
            <Step
              number="03"
              title="Verify"
              body="Every claim comes with a source. Click to jump straight to the page."
            />
            <Step
              number="04"
              title="Listen"
              body="Press play to hear the answer in the accent you prefer."
            />
          </div>
        </section>

        <section className="landing-cta-section">
          <h2 className="landing-cta-title">Ready to reason through your documents?</h2>
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/signup")}>
            Get started free →
          </button>
        </section>
      </main>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="landing-feature">
      <div className="landing-feature-icon">{icon}</div>
      <div className="landing-feature-title">{title}</div>
      <div className="landing-feature-body">{body}</div>
    </div>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="landing-step">
      <div className="landing-step-number">{number}</div>
      <div className="landing-step-title">{title}</div>
      <div className="landing-step-body">{body}</div>
    </div>
  );
}

function LandingCanvas() {
  const ref = (el: HTMLCanvasElement | null) => {
    if (!el) return;
    const canvas = el;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const PARTICLE_COUNT = 70;
    const MAX_DIST = 140;

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.6 + 0.6,
      hue: Math.random() < 0.5 ? 260 : 220,
    }));

    let mouseX = W / 2;
    let mouseY = H / 2;

    const onMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    window.addEventListener("mousemove", onMove);

    const onResize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    let raf = 0;

    const frame = () => {
      ctx.clearRect(0, 0, W, H);

      const gx = mouseX;
      const gy = mouseY;
      const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, 400);
      grd.addColorStop(0, "rgba(124, 92, 255, 0.10)");
      grd.addColorStop(1, "rgba(124, 92, 255, 0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, 0.55)`;
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.18;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(140, 130, 255, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
    };
  };

  return <canvas id="landing-canvas" className="landing-canvas" ref={ref} />;
}
