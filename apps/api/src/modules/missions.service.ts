import { prisma } from '@api/db/prisma';
import { logger } from '@api/utils/logger';
import type { DailyMissionDTO } from '@shared/types';

const MISSION_DEFINITIONS: Array<{
  type: string;
  target: number;
  xpReward: number;
  label: string;
}> = [
  { type: 'COMPLETE_TASKS', target: 3, xpReward: 75, label: 'Complete 3 tasks' },
  { type: 'WRITE_NOTE', target: 1, xpReward: 50, label: 'Write a note' },
  { type: 'COMPLETE_TASKS_URGENT', target: 1, xpReward: 100, label: 'Complete 1 high-priority task' },
];

export class MissionsService {
  async ensureDailyMissions(userId: string): Promise<DailyMissionDTO[]> {
    const today = new Date().toISOString().split('T')[0]!;

    const existing = await prisma.dailyMission.findMany({
      where: { userId, date: today },
    });

    const existingTypes = new Set(existing.map((m) => m.missionType));
    const toCreate = MISSION_DEFINITIONS.filter((m) => !existingTypes.has(m.type));

    if (toCreate.length > 0) {
      await prisma.dailyMission.createMany({
        data: toCreate.map((m) => ({
          userId,
          date: today,
          missionType: m.type,
          target: m.target,
          xpReward: m.xpReward,
        })),
        skipDuplicates: true,
      });
    }

    const all = await prisma.dailyMission.findMany({
      where: { userId, date: today },
    });

    return all.map((m) => {
      const def = MISSION_DEFINITIONS.find((d) => d.type === m.missionType);
      return {
        id: m.id,
        missionType: m.missionType,
        target: m.target,
        progress: m.progress,
        completed: m.completed,
        xpReward: m.xpReward,
        label: def?.label ?? m.missionType,
      };
    });
  }

  async progressMission(userId: string, missionType: string, increment = 1): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      const mission = await prisma.dailyMission.findUnique({
        where: { userId_date_missionType: { userId, date: today, missionType } },
      });
      if (!mission || mission.completed) return;

      const newProgress = mission.progress + increment;
      const nowComplete = newProgress >= mission.target;

      await prisma.dailyMission.update({
        where: { id: mission.id },
        data: { progress: Math.min(newProgress, mission.target), completed: nowComplete },
      });

      if (nowComplete) {
        await prisma.userStats.upsert({
          where: { userId },
          update: { totalXP: { increment: mission.xpReward } },
          create: { userId, totalXP: mission.xpReward },
        });
      }
    } catch (err) {
      logger.error({ err, userId, missionType }, 'Error progressing mission');
    }
  }
}
