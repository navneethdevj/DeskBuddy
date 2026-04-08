import type { UserDTO } from '@shared/types';

export interface AuthTokens {
  accessToken: string;
  user: UserDTO;
}

export interface GoogleCallbackBody {
  code: string;
}

export class AuthService {
  handleGoogleCallback(_body: GoogleCallbackBody): Promise<AuthTokens> {
    throw new Error('Not implemented: handleGoogleCallback');
  }

  refreshAccessToken(_refreshToken: string): Promise<{ accessToken: string }> {
    throw new Error('Not implemented: refreshAccessToken');
  }

  logout(_userId: string): Promise<void> {
    throw new Error('Not implemented: logout');
  }
}
