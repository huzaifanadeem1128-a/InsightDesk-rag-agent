import { useEffect, useRef, useState } from "react";

export function CornerBot() {
  const botRef = useRef<HTMLDivElement>(null);
  const leftEyeRef = useRef<HTMLDivElement>(null);
  const rightEyeRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [blinking, setBlinking] = useState(false);

  const greetings = [
    "Ready when you are",
    "Welcome back",
    "Nice to see you",
    "Let's get to work",
    "Hi there 👋",
  ];

  const sayBubble = (text: string, duration = 3500) => {
    setBubble(text);
    setTimeout(() => setBubble(null), duration);
  };

  useEffect(() => {
    setTimeout(() => {
      sayBubble(greetings[Math.floor(Math.random() * greetings.length)]);
    }, 1200);

    const onMove = (e: MouseEvent) => {
      const bot = botRef.current;
      const le = leftEyeRef.current;
      const re = rightEyeRef.current;
      const head = headRef.current;
      if (!bot || !le || !re || !head) return;

      const rect = bot.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1000) return;

      const maxOffset = 8;
      const angle = Math.atan2(dy, dx);
      const mag = Math.min(1, dist / 200);
      const ox = Math.cos(angle) * maxOffset * mag;
      const oy = Math.sin(angle) * maxOffset * mag;

      le.style.transform = `translate(${ox}px, ${oy}px)`;
      re.style.transform = `translate(${ox}px, ${oy}px)`;

      const tilt = Math.max(-7, Math.min(7, dx / 40));
      head.style.transform = `rotate(${tilt}deg)`;
    };

    window.addEventListener("mousemove", onMove);

    const blinkTimer = setInterval(() => {
      if (Math.random() > 0.6) {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 120);
      }
    }, 5000);

    const bubbleTimer = setInterval(() => {
      if (Math.random() > 0.7) {
        sayBubble(greetings[Math.floor(Math.random() * greetings.length)]);
      }
    }, 22000);

    return () => {
      window.removeEventListener("mousemove", onMove);
      clearInterval(blinkTimer);
      clearInterval(bubbleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = () => {
    setBlinking(true);
    setTimeout(() => setBlinking(false), 140);
    setTimeout(() => {
      setBlinking(true);
      setTimeout(() => setBlinking(false), 140);
    }, 260);
    sayBubble("Hey! 👋", 1800);
  };

  return (
    <div
      className={"corner-bot" + (blinking ? " blinking" : "")}
      ref={botRef}
      title="Say hi!"
      onClick={handleClick}
    >
      <div
        className={"corner-bot-bubble" + (bubble ? " show" : "")}
      >
        {bubble || "Ready when you are"}
      </div>
      <div className="corner-bot-antenna">
        <span className="corner-bot-antenna-dot" />
      </div>
      <div className="corner-bot-head" ref={headRef}>
        <div className="corner-bot-visor">
          <div className="corner-bot-eye" ref={leftEyeRef} />
          <div className="corner-bot-eye" ref={rightEyeRef} />
        </div>
      </div>
      <div className="corner-bot-body">
        <div className="corner-bot-light" />
      </div>
    </div>
  );
}
