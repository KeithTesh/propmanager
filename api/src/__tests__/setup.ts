// api/src/__tests__/setup.ts
/**
 * Vitest global test setup
 * Runs before every test file
 */
import { beforeAll, afterAll } from 'vitest';
import { closeDatabaseConnections } from '../db';
import { closeRedisConnection } from '../db/redis';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.TZ = 'Africa/Nairobi';
process.env.JWT_SECRET = 'test-secret-minimum-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-minimum-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-exactly-32by!';

beforeAll(async () => {
  // Any global test DB setup goes here
});

afterAll(async () => {
  await closeDatabaseConnections();
  await closeRedisConnection();
});