import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

test('scheduler configuration has safe defaults', () => {
  assert.equal(config.workerConcurrency > 0, true);
  assert.equal(config.minSendDelayMs > 0, true);
  assert.equal(config.maxEmailsPerHour > 0, true);
  assert.equal(config.smtp.host, 'smtp.ethereal.email');
});
