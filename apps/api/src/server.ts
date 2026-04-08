import http from 'http';
import { app } from './app';
import config from '@api/config';
import { initSocketServer } from '@api/sockets/socket.server';
import { logger } from '@api/utils/logger';

const httpServer = http.createServer(app);
initSocketServer(httpServer);

httpServer.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'DeskBuddy API server started');
});
