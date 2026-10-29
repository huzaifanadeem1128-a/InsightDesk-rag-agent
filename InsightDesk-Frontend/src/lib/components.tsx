import { useState, type ReactNode } from "react";

/* ============================================================
   BUTTON
   ============================================================ */

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  primary?: boolean;
  block?: boolean;
  disabled?: boolean;
  id?: string;
  title?: string;
}

export function Button({
  children,
  onClick,
  type = "button",
  className = "",
  primary,
  block,
  disabled,
  id,
  title,
}: ButtonProps) {
  const classes = [
    "btn",
    primary ? "btn-primary" : "",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      onClick={onClick}
      className={classes}
      disabled={disabled}
      id={id}
      title={title}
    >
      {children}
    </button>
  );
}

/* ============================================================
   COLLAPSIBLE SIDEBAR PANEL
   ============================================================ */

interface PanelProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Panel({ title, children, defaultOpen = false }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sidebar-panel">
      <div
        className={"sidebar-panel-header" + (open ? "" : " collapsed")}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <span className="chevron">▾</span>
      </div>
      {open && <div className="sidebar-panel-body">{children}</div>}
    </div>
  );
}

/* ============================================================
   PRISM LOGO
   ============================================================ */

export function PrismLogo({ size = "prism" as string }: { size?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={size}>
      <use href="#prism-symbol" />
    </svg>
  );
}
