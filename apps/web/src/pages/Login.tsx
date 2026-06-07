import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@web/stores/authStore';
import api from '@web/lib/api';
import type { UserDTO } from '@shared/types';

interface GoogleCallbackResponse {
  accessToken: string;
  user: UserDTO;
}

const FEATURES = [
  { icon: '⬡', text: 'Kanban board with drag-and-drop' },
  { icon: '◈', text: 'Notes and real-time collaboration' },
  { icon: '◉', text: 'Daily missions and XP streaks' },
];

export default function Login(): JSX.Element {
  const navigate = useNavigate();
  const { setAccessToken, setUser } = useAuthStore();
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      window.location.href = '/api/v1/auth/google';
      return;
    }

    try {
      const { data } = await api.post<GoogleCallbackResponse>('/auth/google/callback', { code });
      setAccessToken(data.accessToken);
      setUser(data.user);
      void navigate('/');
    } catch {
      setError('Sign in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-bg px-4"
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #2c2924 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Subtle ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, #e8963a 0%, transparent 70%)' }}
        />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm animate-slide-up">
        {/* Brand */}
        <div className="mb-8 text-center">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink-3">Welcome to</p>
          <h1
            className="text-5xl font-extrabold text-ink"
            style={{ fontFamily: '"Bricolage Grotesque", system-ui, sans-serif', letterSpacing: '-0.02em' }}
          >
            DeskBuddy
          </h1>
          <p className="mt-2 text-sm text-ink-3">Your productivity, levelled up.</p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-modal">
          <h2 className="mb-5 text-sm font-semibold text-ink">Sign in to continue</h2>

          {error && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-err/30 bg-err-muted px-3 py-2.5 text-sm text-err animate-scale-in">
              <span aria-hidden="true">⚠</span>
              {error}
            </div>
          )}

          {/* Google button */}
          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium text-ink transition-all duration-150 hover:border-border-2 hover:bg-surface-3 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
            ) : (
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-ink-4">What you get</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Feature list */}
          <ul className="space-y-2.5">
            {FEATURES.map(({ icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-xs text-ink-3">
                <span className="text-base text-accent opacity-70" aria-hidden="true">{icon}</span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-center text-xs text-ink-4">
          By signing in you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}
