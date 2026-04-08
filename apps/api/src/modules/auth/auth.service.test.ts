import { AuthService } from './auth.service';

jest.mock('@api/db/prisma');
jest.mock('@api/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AuthService();
  });

  describe('handleGoogleCallback', () => {
    it('Not implemented', () => {
      expect(() => service.handleGoogleCallback({ code: 'test' })).toThrow('Not implemented');
    });
  });

  describe('refreshAccessToken', () => {
    it('Not implemented', () => {
      expect(() => service.refreshAccessToken('token')).toThrow('Not implemented');
    });
  });

  describe('logout', () => {
    it('Not implemented', () => {
      expect(() => service.logout('userId')).toThrow('Not implemented');
    });
  });
});
