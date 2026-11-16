/** Test Redis (docker-compose / CI service), database 1 so it never touches real data. */
export const testRedisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1';
