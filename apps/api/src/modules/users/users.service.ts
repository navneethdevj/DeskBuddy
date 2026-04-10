import { prisma as defaultPrisma } from '@api/db/prisma';
import { HttpError } from '@api/utils/httpError';
import { toUserDTO } from '@api/utils/mappers';
import type { UserDTO } from '@shared/types';
import type { UpdateUserInput } from '@shared/schemas';

export class UsersService {
  constructor(private readonly db = defaultPrisma) {}

  async getById(userId: string): Promise<UserDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpError(404, 'User not found', 'NOT_FOUND');
    }
    return toUserDTO(user);
  }

  async update(userId: string, data: UpdateUserInput): Promise<UserDTO> {
    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new HttpError(404, 'User not found', 'NOT_FOUND');
    }
    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      },
    });
    return toUserDTO(updated);
  }
}
