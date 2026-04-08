import { TasksService } from './tasks.service';

jest.mock('@api/db/prisma');
jest.mock('@api/sockets/socket.server', () => ({ getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })) }));
jest.mock('@api/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

describe('TasksService', () => {
  let service: TasksService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new TasksService();
  });

  describe('list', () => {
    it('Not implemented', () => {
      expect(() => service.list('userId', 'workspaceId')).toThrow('Not implemented');
    });
  });

  describe('create', () => {
    it('Not implemented', () => {
      expect(() =>
        service.create('userId', 'workspaceId', { title: 'Test', status: 'TODO' })
      ).toThrow('Not implemented');
    });
  });

  describe('getById', () => {
    it('Not implemented', () => {
      expect(() => service.getById('userId', 'workspaceId', 'taskId')).toThrow('Not implemented');
    });
  });

  describe('update', () => {
    it('Not implemented', () => {
      expect(() => service.update('userId', 'workspaceId', 'taskId', { title: 'Updated' })).toThrow(
        'Not implemented'
      );
    });
  });

  describe('delete', () => {
    it('Not implemented', () => {
      expect(() => service.delete('userId', 'workspaceId', 'taskId')).toThrow('Not implemented');
    });
  });
});
