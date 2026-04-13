import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { useAuthStore } from '@web/stores/authStore';
import Dashboard from './Dashboard';
import Login from './Login';

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// Default export allowed for page-level components
export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
