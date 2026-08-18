import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('email-sends', { connection });
export const emailEvents = new QueueEvents('email-sends', { connection });
export { Worker };
