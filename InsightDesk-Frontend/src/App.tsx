import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuthStore } from "./store";
import { setUnauthorizedHandler } from "./api";
import { PrismSymbol } from "./components/PrismSymbol";
import { LandingPage } from "./pages/LandingPage";
import { AuthPages } from "./pages/AuthPages";
import { WorkspacePage } from "./pages/WorkspacePage";
import { AdminPage } from "./pages/AdminPage";
import { ProfilePage } from "./pages/ProfilePage";
import { DashboardPage } from "./pages/DashboardPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AdminUserDetailPage } from "./pages/AdminUserDetailPage";

function Router() {
  const { token, role, hydrateFromStorage, clearAuthState } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    hydrateFromStorage();
    setUnauthorizedHandler(() => {
      clearAuthState();
      navigate("/login");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/login"
        element={
          token ? (
            <Navigate to="/workspace" replace />
          ) : (
            <AuthPages initialPanel="login" onSuccess={() => navigate("/workspace")} onBackToLanding={() => navigate("/")} />
          )
        }
      />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route
        path="/signup"
        element={
          token ? (
            <Navigate to="/workspace" replace />
          ) : (
            <AuthPages initialPanel="signup" onSuccess={() => navigate("/workspace")} onBackToLanding={() => navigate("/")} />
          )
        }
      />
      <Route
        path="/workspace"
        element={token ? <WorkspacePage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/profile"
        element={token ? <ProfilePage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/dashboard"
        element={token ? <DashboardPage /> : <Navigate to="/login" replace />}
      />

      <Route
        path="/admin/users/:userId"
        element={
          token && role === "admin" ? (
            <AdminUserDetailPage />
          ) : (
            <Navigate to={token ? "/workspace" : "/login"} replace />
          )
        }
      />

      <Route
        path="/admin"
        element={
          token && role === "admin" ? (
            <AdminPage />
          ) : (
            <Navigate to={token ? "/workspace" : "/login"} replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PrismSymbol />
      <Router />
    </BrowserRouter>
  );
}