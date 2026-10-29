import { useState } from "react";
import type { ActivityEvent } from "../types";

export function TraceView({ activity }: { activity: ActivityEvent[] }) {
  const [open, setOpen] = useState(false);

  if (!activity || activity.length === 0) return null;

  const stepLabel =
    activity.length === 1 ? "1 step" : `${activity.length} steps`;

  return (
    <div className="trace-box">
      <button
        type="button"
        className={"trace-toggle" + (open ? " open" : "")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="trace-toggle-arrow">▸</span>
        <span className="trace-toggle-label">Agent activity</span>
        <span className="trace-toggle-count">{stepLabel}</span>
      </button>
      {open && (
        <div className="trace-list">
          {activity.map((event, i) => {
            const kind = event.type || "activity";
            return (
              <div className="trace-step" data-kind={kind} key={i}>
                <div className="trace-step-header">
                  {kind.toUpperCase()}
                </div>
                <div className="trace-step-body">{event.message || ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
