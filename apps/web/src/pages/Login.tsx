import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@web/stores/authStore';
import { Button } from '@web/components/ui/Button';
import api from '@web/lib/api';
import type { UserDTO } from '@shared/types';

interface GoogleCallbackResponse {
  accessToken: string;
  user: UserDTO;
}

// Default export allowed for page-level components
export default function Login(): JSX.Element {
  const navigate = useNavigate();
  const { setAccessToken, setUser } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * In a real deployment this would redirect the browser to Google's OAuth consent
   * page and the callback URL would return the `code`.  Here we open a popup or
   * redirect to the backend's Google OAuth initiation endpoint so users can sign in.
   */
  const handleGoogleSignIn = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    // The OAuth code comes back to this page via query param after the redirect.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (!code) {
      // Redirect the browser to Google to start the OAuth flow.
      // The backend exposes an initiation redirect at /api/v1/auth/google.
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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Welcome to DeskBuddy</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to access your workspace</p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200"
          >
            {error}
          </div>
        )}

        <Button
          className="w-full gap-2"
          isLoading={isLoading}
          onClick={() => void handleGoogleSignIn()}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </Button>
      </div>
    </div>
  );
}
