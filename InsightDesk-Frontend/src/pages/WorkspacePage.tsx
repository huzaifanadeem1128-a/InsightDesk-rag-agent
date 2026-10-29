import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getChats, getChat, getDocuments, getRagStatus, logout } from "../api";
import {
  useAuthStore,
  useChatsStore,
  useDocsStore,
} from "../store";
import { Sidebar } from "../components/Sidebar";
import { ChatArea } from "../components/ChatArea";
import { useUIStore } from "../store";

export function WorkspacePage() {
  const navigate = useNavigate();
  const { email, role, clearAuthState } = useAuthStore();
  const {
    setChats,
    setCurrentChat,
    setCurrentChatArchived,
    setMessages,
    setChatTitle,
  } = useChatsStore();
  const { setDocuments, setStatus, setProcessingInfo } = useDocsStore();

  const { sidebarOpen } = useUIStore();

  const refresh = async () => {
    try {
      const [status, chats, documents] = await Promise.all([
        getRagStatus(),
        getChats(),
        getDocuments(),
      ]);

      setStatus(status);
      setChats(chats.chats);
      setCurrentChat(chats.current_chat_id);
      setDocuments(documents.documents);

      if (chats.current_chat_id) {
        const detail = await getChat(chats.current_chat_id);
        setMessages(detail.messages);
        setCurrentChatArchived(detail.archived);
        setChatTitle(detail.name || "InsightDesk");
      } else {
        setMessages([]);
        setCurrentChatArchived(false);
        setChatTitle("InsightDesk");
      }
    } catch (e) {
      console.error("refresh failed:", e);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    clearAuthState();
    setProcessingInfo(null);
    navigate("/");
  };

  return (
    <div className="workspace-view">
      <div className="workspace-ambient">
        <div className="workspace-orb workspace-orb-1" />
        <div className="workspace-orb workspace-orb-2" />
        <div className="workspace-orb workspace-orb-3" />
      </div>
      <header className="top-header">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 64 64" className="prism">
              <use href="#prism-symbol" />
            </svg>
          </div>
          <div>
            <div className="brand-name">InsightDesk</div>
            <div className="brand-subtitle">
              Intelligent document workspace
            </div>
          </div>
        </div>
        <div className="top-header-right">
          <span className="user-email">{email}</span>
          {role === "admin" && (
            <button className="btn btn-admin" onClick={() => navigate("/admin")}>
              Admin
            </button>
          )}
        </div>
      </header>

      <div
        className={
          "workspace-layout" + (sidebarOpen ? "" : " sidebar-hidden")
        }
      >
        <Sidebar onLogout={handleLogout} onRefresh={refresh} />
        <ChatArea />
      </div>
    </div>
  );
}
