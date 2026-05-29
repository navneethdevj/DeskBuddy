import { prisma } from '@api/db/prisma';
import { logger } from '@api/utils/logger';
import type { UserStatsDTO } from '@shared/types';

export class StatsService {
  async onTaskCompleted(userId: string): Promise<void> {
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const stats = await prisma.userStats.findUnique({ where: { userId } });

      let currentStreak = 1;
      if (stats?.lastActivityDate) {
        const lastDate = new Date(stats.lastActivityDate);
        lastDate.setUTCHours(0, 0, 0, 0);
        const daysDiff = Math.floor(
          (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysDiff === 0) {
          currentStreak = stats.currentStreak;
        } else if (daysDiff === 1) {
          currentStreak = stats.currentStreak + 1;
        } else {
          currentStreak = 1;
        }
      }

      const longestStreak = Math.max(currentStreak, stats?.longestStreak ?? 0);
      const BASE_XP = 10;
      const streakMultiplier = currentStreak >= 7 ? 2.0 : currentStreak >= 3 ? 1.5 : 1.0;
      const xpEarned = Math.floor(BASE_XP * streakMultiplier);

      await prisma.userStats.upsert({
        where: { userId },
        update: {
          currentStreak,
          longestStreak,
          totalTasksDone: { increment: 1 },
          totalXP: { increment: xpEarned },
          lastActivityDate: new Date(),
        },
        create: {
          userId,
          currentStreak: 1,
          longestStreak: 1,
          totalTasksDone: 1,
          totalXP: BASE_XP,
          lastActivityDate: new Date(),
        },
      });
    } catch (err) {
      logger.error({ err, userId }, 'Error updating user stats');
    }
  }

  async getStats(userId: string): Promise<UserStatsDTO> {
    const stats = await prisma.userStats.findUnique({ where: { userId } });
    return {
      currentStreak: stats?.currentStreak ?? 0,
      longestStreak: stats?.longestStreak ?? 0,
      totalTasksDone: stats?.totalTasksDone ?? 0,
      totalXP: stats?.totalXP ?? 0,
    };
  }
}
