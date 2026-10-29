import { useEffect, useRef, useState } from "react";
import { Panel, Button } from "../lib/components";
import {
  createChat,
  deleteChat,
  deleteDocument,
  documentImpact,
  exportChatMarkdown,
  exportChatPdf,
  renameChat,
  switchChat,
  togglePinChat,
  uploadDocuments,
} from "../api";
import {
  useChatsStore,
  useDocsStore,
  useVoiceStore,
  useAuthStore,
} from "../store";
import { groupVoices } from "../lib/voice";
import type { DocumentImpact, ProcessingInfo } from "../types";
import { DeleteModal } from "./DeleteModal";
import { useNavigate } from "react-router-dom";

interface Props {
  onLogout: () => void;
  onRefresh: () => void;
}

function initialsFromEmail(email: string): string {
  if (!email) return "?";
  const local = email.split("@")[0];
  if (!local) return "?";
  return local.slice(0, 2).toUpperCase();
}

function colorFromString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

export function Sidebar({ onLogout, onRefresh }: Props) {
  const navigate = useNavigate();
  const { chats, currentChatId } = useChatsStore();
  const { email} = useAuthStore();
  const {
    documents,
    selectedDocumentIds,
    chunkSize,
    chunkOverlap,
    topK,
    processingInfo,
    status,
    toggleDocumentSelection,
    setProcessingInfo,
  } = useDocsStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [userMenuOpen]);

  const { selectedVoiceURI, voiceRate, setVoice, setRate } = useVoiceStore();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceStatus, setVoiceStatus] = useState("Voices load automatically.");

  useEffect(() => {
    if (typeof speechSynthesis === "undefined") {
      setVoiceStatus("Voice not supported in this browser.");
      return;
    }
    const load = () => {
      const all = speechSynthesis.getVoices();
      if (all.length === 0) return;
      setVoices(all);
      const groups = groupVoices(all);
      setVoiceStatus(
        `${groups.soft.length} natural voice(s), ${
          groups.neutral.length + groups.novelty.length
        } more available.`
      );
    };
    load();
    speechSynthesis.onvoiceschanged = load;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voiceGroups = groupVoices(voices);

  // ----- Rename state -----
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");

  // ----- Delete confirmation state -----
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // ----- Upload state -----
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [impact, setImpact] = useState<DocumentImpact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);

  // ----- Retrieval inputs -----
  const [cs, setCs] = useState(chunkSize);
  const [co, setCo] = useState(chunkOverlap);
  const [tk, setTk] = useState(topK);

  useEffect(() => setCs(chunkSize), [chunkSize]);
  useEffect(() => setCo(chunkOverlap), [chunkOverlap]);
  useEffect(() => setTk(topK), [topK]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const active = chats.filter((c) => !c.archived);
  // Pinned chats already come first from the store, but keep this sort
  // here as a safety net in case other code paths add chats unsorted.
  const sortedActive = [...active].sort((a, b) => {
    if (a.pinned === b.pinned) return 0;
    return a.pinned ? -1 : 1;
  });
  const archived = chats.filter((c) => c.archived);

  // Chat history: show 5 recent by default; "show all" toggle
  const [showAllChats, setShowAllChats] = useState(false);
  const visibleActive = showAllChats
    ? sortedActive
    : sortedActive.slice(0, 5);
  const hasMoreActive = sortedActive.length > 5;

  // Close inline dialogs when switching chats
  useEffect(() => {
    setIsRenaming(false);
    setRenameInput("");
    setIsConfirmingDelete(false);
  }, [currentChatId]);

  // --------------------------------------------------
  // HANDLERS
  // --------------------------------------------------

  const handleNewChat = async () => {
    try {
      await createChat();
      onRefresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleSwitch = async (chatId: string) => {
    if (chatId === currentChatId) return;
    try {
      await switchChat(chatId);
      onRefresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleRenameInline = async () => {
    const name = renameInput.trim();
    if (!name || !currentChatId) {
      setIsRenaming(false);
      setRenameInput("");
      return;
    }

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [userMenuOpen]);

    try {
      await renameChat(currentChatId, name);
      setIsRenaming(false);
      setRenameInput("");
      onRefresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDeleteChat = async () => {
    if (!currentChatId) return;
    try {
      await deleteChat(currentChatId);
      onRefresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const [exportBusy, setExportBusy] = useState<"md" | "pdf" | null>(null);

  const handleExport = async (format: "md" | "pdf") => {
    if (!currentChatId || exportBusy) return;
    setExportBusy(format);
    try {
      if (format === "md") {
        await exportChatMarkdown(currentChatId);
      } else {
        await exportChatPdf(currentChatId);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExportBusy(null);
    }
  };

  const handleTogglePin = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();          // don't switch chat when pinning
    try {
      const res = await togglePinChat(chatId);

      // Update store locally — instant feedback, no refetch.
      const store = useChatsStore.getState();
      const updated = store.chats.map((c) =>
        c.chat_id === chatId ? { ...c, pinned: res.pinned } : c
      );

      // Sort: pinned first, then by original order (which is newest-first
      // from the backend). We keep insertion order stable by using a
      // stable sort.
      updated.sort((a, b) => {
        if (a.pinned === b.pinned) return 0;
        return a.pinned ? -1 : 1;
      });

      store.setChats(updated);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles(Array.from(files));
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) {
      setUploadError("Please select at least one document.");
      return;
    }
    if (co >= cs) {
      setUploadError("Chunk overlap must be smaller than chunk size.");
      return;
    }
    setUploadError(null);
    setUploadBusy(true);
    try {
      const res = await uploadDocuments(pendingFiles, cs, co, tk);
      setProcessingInfo(res.processing_info as ProcessingInfo);
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onRefresh();
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploadBusy(false);
    }
  };

  const handleDeleteDocClick = async (docId: string) => {
    try {
      const res = await documentImpact(docId);
      setImpact(res);
      setDeleteDocId(docId);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteDocId) return;
    setDeleteBusy(true);
    try {
      await deleteDocument(deleteDocId);
      setImpact(null);
      setDeleteDocId(null);
      onRefresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const csError = co >= cs;

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <aside className="sidebar">
      {/* -------- TOP: Primary action -------- */}
      <div className="sidebar-top">
        <Button primary block onClick={handleNewChat}>
          ＋  New conversation
        </Button>
      </div>

      {/* -------- MIDDLE: Scrollable content -------- */}
      <div className="sidebar-scroll">
        {/* ---- CHATS ---- */}
        <div className="sidebar-subtitle">CHAT HISTORY</div>

        <div className="conversation-list">
          {chats.length === 0 ? (
            <div className="conversation-empty">
              No conversations yet.
            </div>
          ) : (
            <>
              {visibleActive.map((c) => (
                <button
                  key={c.chat_id}
                  className={
                    "conversation-item" +
                    (c.chat_id === currentChatId ? " active" : "") +
                    (c.pinned ? " pinned" : "")
                  }
                  onClick={() => handleSwitch(c.chat_id)}
                >
                  <span className="conversation-item-label">
                    {c.pinned ? "📌" : c.chat_id === currentChatId ? "●" : "○"}{" "}
                    {c.name}
                  </span>
                  <span
                    className="conversation-pin-btn"
                    title={c.pinned ? "Unpin" : "Pin to top"}
                    onClick={(e) => handleTogglePin(c.chat_id, e)}
                    role="button"
                  >
                    📌
                  </span>
                </button>
              ))}

              {hasMoreActive && (
                <button
                  type="button"
                  className="show-all-link"
                  onClick={() => setShowAllChats((s) => !s)}
                >
                  {showAllChats
                    ? "Show less"
                    : `Show all (${active.length})`}
                </button>
              )}

              {archived.length > 0 && (
                <>
                  <div className="conversation-divider">Archived</div>
                  {archived.slice(0, 3).map((c) => (
                    <button
                      key={c.chat_id}
                      className={
                        "conversation-item archived" +
                        (c.chat_id === currentChatId ? " active" : "")
                      }
                      onClick={() => handleSwitch(c.chat_id)}
                    >
                      {c.chat_id === currentChatId ? "●" : "○"} {c.name}
                      <span className="conversation-lock">🔒</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {currentChatId && (
          <div className="conversation-manage-wrapper">
            <div className="conversation-manage-row">
              <button
                type="button"
                className="small-link"
                onClick={() => {
                  const currentName =
                    chats.find((c) => c.chat_id === currentChatId)?.name || "";
                  setRenameInput(currentName);
                  setIsRenaming(true);
                  setIsConfirmingDelete(false);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="small-link"
                onClick={() => handleExport("md")}
                disabled={exportBusy !== null}
                title="Export as Markdown"
              >
                {exportBusy === "md" ? "…" : "Export MD"}
              </button>
              <button
                type="button"
                className="small-link"
                onClick={() => handleExport("pdf")}
                disabled={exportBusy !== null}
                title="Export as PDF"
              >
                {exportBusy === "pdf" ? "…" : "Export PDF"}
              </button>
              <button
                type="button"
                className="small-link danger"
                onClick={() => {
                  setIsConfirmingDelete(true);
                  setIsRenaming(false);
                }}
              >
                Delete
              </button>
            </div>

            {isRenaming && (
              <div className="rename-inline">
                <input
                  type="text"
                  className="input rename-input"
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleRenameInline();
                    } else if (e.key === "Escape") {
                      setIsRenaming(false);
                      setRenameInput("");
                    }
                  }}
                />
                <div className="rename-actions">
                  <button
                    type="button"
                    className="small-link"
                    onClick={handleRenameInline}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="small-link"
                    onClick={() => {
                      setIsRenaming(false);
                      setRenameInput("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {isConfirmingDelete && (
              <div className="delete-confirm-inline">
                <div className="delete-confirm-header">
                  <span className="delete-confirm-text">
                    Delete{" "}
                    <strong>
                      "
                      {
                        chats.find((c) => c.chat_id === currentChatId)
                          ?.name
                      }
                      "
                    </strong>
                    ?
                  </span>
                  <button
                    type="button"
                    className="delete-confirm-close"
                    onClick={() => setIsConfirmingDelete(false)}
                    aria-label="Cancel"
                  >
                    ✕
                  </button>
                </div>
                <div className="delete-confirm-actions">
                  <button
                    type="button"
                    className="confirm-btn confirm-btn-cancel"
                    onClick={() => setIsConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="confirm-btn confirm-btn-delete"
                    onClick={async () => {
                      setIsConfirmingDelete(false);
                      await handleDeleteChat();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="sidebar-divider" />

        {/* ---- SETTINGS ---- */}
        <Panel title="⚙  Settings">
          <div className="settings-section">
            <div className="settings-label">Retrieval</div>
            <label className="field-label">Chunk size</label>
            <input
              className="input"
              type="number"
              value={cs}
              onChange={(e) => setCs(Number(e.target.value))}
            />
            <label className="field-label">Chunk overlap</label>
            <input
              className="input"
              type="number"
              value={co}
              onChange={(e) => setCo(Number(e.target.value))}
            />
            <label className="field-label">Top K</label>
            <input
              className="input"
              type="number"
              value={tk}
              onChange={(e) => setTk(Number(e.target.value))}
            />
            {csError && (
              <div className="form-error">
                Overlap must be smaller than chunk size.
              </div>
            )}
          </div>

          <div className="settings-section">
            <div className="settings-label">Voice / Accent</div>
            <select
              className="input"
              value={selectedVoiceURI || ""}
              onChange={(e) => setVoice(e.target.value || null)}
            >
              <option value="">Default voice</option>
              {voiceGroups.soft.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}
                </option>
              ))}
              {voiceGroups.neutral.length > 0 && (
                <option disabled>─────── more voices ───────</option>
              )}
              {voiceGroups.neutral.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}
                </option>
              ))}
              {voiceGroups.novelty.length > 0 && (
                <option disabled>─────── novelty ───────</option>
              )}
              {voiceGroups.novelty.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}
                </option>
              ))}
            </select>
            <label className="field-label">Speed</label>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={voiceRate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
            <div className="caption">{voiceRate.toFixed(1)}×</div>
            <div className="caption">{voiceStatus}</div>
          </div>
        </Panel>

        {/* ---- DOCUMENTS ---- */}
        <Panel title="▣  Documents">
          <div className="settings-section">
            <div className="settings-label">Add documents</div>

            <label className="file-dropzone">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                multiple
                hidden
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              <div className="file-dropzone-inner">
                <div className="file-dropzone-title">Upload PDF or TXT</div>
                <div className="file-dropzone-hint">
                  Click to browse or drag files here
                </div>
              </div>
            </label>

            <div className="file-preview-list">
              {pendingFiles.map((f) => (
                <div className="file-preview-item" key={f.name}>
                  {f.name}
                </div>
              ))}
            </div>

            {uploadError && <div className="form-error">{uploadError}</div>}

            <Button primary block onClick={handleUpload} disabled={uploadBusy}>
              {uploadBusy ? "Indexing..." : "Build knowledge base"}
            </Button>
          </div>

          <div className="settings-section">
            <div className="settings-label">
              Library ({documents.length})
            </div>
            <div className="caption">
              Select documents to search (none selected = search all)
            </div>

            {documents.length === 0 ? (
              <div className="caption">Your document library is empty.</div>
            ) : (
              <div className="document-grid">
                {documents.map((d) => {
                  const checked = selectedDocumentIds.includes(d.document_id);
                  return (
                    <div
                      className={
                        "document-grid-card" + (checked ? " selected" : "")
                      }
                      key={d.document_id}
                    >
                      <div className="document-grid-header">
                        <input
                          type="checkbox"
                          className="document-card-checkbox"
                          checked={checked}
                          onChange={() => toggleDocumentSelection(d.document_id)}
                        />
                        <button
                          className="document-delete"
                          title="Delete document"
                          onClick={() => handleDeleteDocClick(d.document_id)}
                        >
                          🗑️
                        </button>
                      </div>
                      <div className="document-grid-icon">◈</div>
                      <div className="document-grid-name" title={d.name}>
                        {d.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>

        {/* ---- STATUS ---- */}
        <Panel title="●  Status">
          {status ? (
            <div className="system-status">
              <div className="system-services">
                <div className="system-title">SERVICES</div>
                <div className="system-service">
                  <span className="system-service-dot">●</span> LLM — Ready
                </div>
                <div className="system-service">
                  <span className="system-service-dot">●</span> Embeddings — Ready
                </div>
                <div className="system-service">
                  <span className="system-service-dot">●</span> Agent — Ready
                </div>
              </div>
              <div className="system-info">
                <strong>Documents:</strong> {status.document_count}
              </div>
              <div className="system-model-label">LLM</div>
              <div className="system-info">{status.llm_model}</div>
            </div>
          ) : (
            <div className="caption">Status unavailable.</div>
          )}

          {processingInfo && (
            <>
              <div className="sidebar-divider" />
              <div className="caption">
                Last index: {processingInfo.chunk_count} chunks,{" "}
                {processingInfo.embedding_dimension}d
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* -------- BOTTOM: User + Logout -------- */}
      <div className="sidebar-bottom">
        <div className="sidebar-user-menu-wrapper" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="sidebar-user-menu" role="menu">
              <button
                type="button"
                className="sidebar-user-menu-item"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate("/profile");
                }}
                role="menuitem"
              >
                <span className="sidebar-user-menu-icon">👤</span>
                <span>Profile</span>
              </button>
              <button
                type="button"
                className="sidebar-user-menu-item"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate("/dashboard");
                }}
                role="menuitem"
              >
                <span className="sidebar-user-menu-icon">📊</span>
                <span>Dashboard</span>
              </button>
              <div className="sidebar-user-menu-divider" />
              <button
                type="button"
                className="sidebar-user-menu-item danger"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout();
                }}
                role="menuitem"
              >
                <span className="sidebar-user-menu-icon">🚪</span>
                <span>Log out</span>
              </button>
            </div>
          )}

          <button
            type="button"
            className={
              "sidebar-user-trigger" + (userMenuOpen ? " open" : "")
            }
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
          >
            <span className="sidebar-avatar-btn">
              <span
                className="sidebar-avatar-initials"
                style={{ background: colorFromString(email || "user") }}
              >
                {initialsFromEmail(email || "")}
              </span>
            </span>
            <span className="sidebar-user-email" title={email || ""}>
              {email || "user"}
            </span>
            <span className="sidebar-user-chevron">
              {userMenuOpen ? "▾" : "▴"}
            </span>
          </button>
        </div>
      </div>

      {impact && (
        <DeleteModal
          impact={impact}
          onCancel={() => {
            setImpact(null);
            setDeleteDocId(null);
          }}
          onConfirm={confirmDelete}
          busy={deleteBusy}
        />
      )}
    </aside>
  );
}
