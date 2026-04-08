import type { UserDTO } from '@shared/types';
import type { UpdateUserInput } from './users.types';

export class UsersService {
  getById(_userId: string): Promise<UserDTO> {
    throw new Error('Not implemented: getById');
  }

  update(_userId: string, _data: UpdateUserInput): Promise<UserDTO> {
    throw new Error('Not implemented: update');
  }
}
