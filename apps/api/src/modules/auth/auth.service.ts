import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma as defaultPrisma } from '@api/db/prisma';
import { getRedis as defaultGetRedis, type RedisGetter } from '@api/db/redis';
import config from '@api/config';
import { HttpError } from '@api/utils/httpError';
import { logger } from '@api/utils/logger';
import { toUserDTO } from '@api/utils/mappers';
import type { PrismaClient } from '@prisma/client';
import type { UserDTO } from '@shared/types';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserDTO;
}

export interface GoogleCallbackBody {
  code: string;
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REFRESH_KEY_PREFIX = 'rt:';

export class AuthService {
  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    private readonly getRedisClient: RedisGetter = defaultGetRedis,
  ) {}

  async handleGoogleCallback(body: GoogleCallbackBody): Promise<AuthTokens> {
    // 1. Exchange authorization code for a Google access token
    let googleAccessToken: string;
    try {
      const { data } = await axios.post<GoogleTokenResponse>(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code: body.code,
          client_id: config.GOOGLE_CLIENT_ID,
          client_secret: config.GOOGLE_CLIENT_SECRET,
          redirect_uri: config.GOOGLE_CALLBACK_URL,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      googleAccessToken = data.access_token;
    } catch (err) {
      logger.warn({ err }, 'Google token exchange failed');
      throw new HttpError(401, 'Failed to exchange Google authorization code', 'UNAUTHORIZED');
    }

    // 2. Fetch user profile from Google
    let profile: GoogleUserInfo;
    try {
      const { data } = await axios.get<GoogleUserInfo>(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${googleAccessToken}` } },
      );
      profile = data;
    } catch (err) {
      logger.warn({ err }, 'Google userinfo fetch failed');
      throw new HttpError(401, 'Failed to fetch Google user profile', 'UNAUTHORIZED');
    }

    // 3. Upsert user in DB (re-login updates name/avatar)
    const user = await this.db.user.upsert({
      where: { googleId: profile.id },
      update: { name: profile.name, avatarUrl: profile.picture ?? null, email: profile.email },
      create: {
        googleId: profile.id,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture ?? null,
      },
    });

    // 4. Issue access + refresh tokens
    const accessToken = this._signAccessToken(user.id, user.email);
    const opaqueToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = `${user.id}:${opaqueToken}`;

    const redis = await this.getRedisClient();
    await redis.set(`${REFRESH_KEY_PREFIX}${user.id}`, opaqueToken, {
      EX: REFRESH_TTL_SECONDS,
    });

    logger.info({ userId: user.id }, 'User authenticated via Google');
    return { accessToken, refreshToken, user: toUserDTO(user) };
  }

  async refreshAccessToken(
    providedToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!providedToken) {
      throw new HttpError(401, 'Refresh token missing', 'UNAUTHORIZED');
    }

    const colonIdx = providedToken.indexOf(':');
    if (colonIdx === -1) {
      throw new HttpError(401, 'Invalid refresh token format', 'UNAUTHORIZED');
    }

    const userId = providedToken.slice(0, colonIdx);
    const opaqueToken = providedToken.slice(colonIdx + 1);

    const redis = await this.getRedisClient();
    const stored = await redis.get(`${REFRESH_KEY_PREFIX}${userId}`);
    if (!stored || stored !== opaqueToken) {
      throw new HttpError(401, 'Invalid or expired refresh token', 'UNAUTHORIZED');
    }

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      await redis.del(`${REFRESH_KEY_PREFIX}${userId}`);
      throw new HttpError(401, 'User not found', 'UNAUTHORIZED');
    }

    // Rotate: issue new opaque token, replace in Redis
    const newOpaqueToken = crypto.randomBytes(32).toString('hex');
    const newRefreshToken = `${userId}:${newOpaqueToken}`;
    await redis.set(`${REFRESH_KEY_PREFIX}${userId}`, newOpaqueToken, {
      EX: REFRESH_TTL_SECONDS,
    });

    const accessToken = this._signAccessToken(user.id, user.email);
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string): Promise<void> {
    const redis = await this.getRedisClient();
    await redis.del(`${REFRESH_KEY_PREFIX}${userId}`);
    logger.info({ userId }, 'User logged out');
  }

  private _signAccessToken(userId: string, email: string): string {
    // expiresIn expects StringValue from ms; cast via SignOptions to satisfy strict types
    return jwt.sign(
      { userId, email },
      config.JWT_ACCESS_SECRET,
      { expiresIn: config.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions,
    );
  }
}
