import './worker.js';

console.log(`ReachInbox BullMQ worker started with concurrency ${process.env.WORKER_CONCURRENCY ?? '10'}`);
