import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { useAuthStore } from '@web/stores/authStore';
import { SplashScreen } from '@web/components/SplashScreen';

// Code-split page chunks — loaded while SplashScreen is visible
const Dashboard = lazy(() => import('./Dashboard'));
const Login     = lazy(() => import('./Login'));

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const accessToken = useAuthStore((s) => s.accessToken);
  return accessToken ? children : <Navigate to="/login" replace />;
}

export default function App(): JSX.Element {
  /**
   * `appReady` drives the SplashScreen exit.
   *
   * We wait for the browser's first idle period after mount — this means
   * the React tree has rendered, lazy chunks are resolved, and the browser
   * has had a chance to parse / paint the first frame.  The `timeout: 1200`
   * fallback prevents an indefinitely-open splash on slow devices.
   */
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    const mark = (): void => setAppReady(true);

    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(mark, { timeout: 1200 });
      return () => cancelIdleCallback(id);
    }

    // Safari / older browsers fallback
    const id = setTimeout(mark, 150);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      {/* Overlay: covers the app while it boots */}
      <SplashScreen isReady={appReady} minDuration={2700} />

      <BrowserRouter>
        {/*
         * null fallback: SplashScreen already covers the screen while
         * lazy chunks are downloading, so we don't need a secondary spinner.
         */}
        <Suspense fallback={null}>
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
        </Suspense>
      </BrowserRouter>
    </>
  );
}
