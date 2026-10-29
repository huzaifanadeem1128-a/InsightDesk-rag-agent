import type { DocumentImpact } from "../types";

interface Props {
  impact: DocumentImpact;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

export function DeleteModal({ impact, onCancel, onConfirm, busy }: Props) {
  const affected = impact.affected_chats || 0;
  const alreadyArchived = impact.already_archived || 0;

  const activeChats = impact.chats.filter((c) => !c.archived);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Delete document?</div>
        <div className="modal-body">
          <div>
            You are about to permanently delete{" "}
            <strong>{impact.document_name}</strong> from your knowledge base.
          </div>

          {affected > 0 && (
            <div className="modal-impact">
              <div>
                <span className="modal-impact-count">{affected}</span> active
                conversation{affected === 1 ? "" : "s"} used this document.{" "}
                {affected === 1 ? "It" : "They"} will be{" "}
                <strong>archived</strong> (read-only) after deletion.
              </div>
              <ul className="modal-impact-list">
                {activeChats.map((c) => (
                  <li key={c.chat_id}>{c.name}</li>
                ))}
              </ul>
            </div>
          )}

          {alreadyArchived > 0 && (
            <div className="modal-warning">
              {alreadyArchived} already-archived conversation
              {alreadyArchived === 1 ? "" : "s"} also referenced this document.
            </div>
          )}

          {affected === 0 && alreadyArchived === 0 && (
            <div className="modal-warning">
              No conversations reference this document. It's safe to delete.
            </div>
          )}

          <div className="modal-warning">This action cannot be undone.</div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
