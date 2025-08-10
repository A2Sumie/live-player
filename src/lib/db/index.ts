import { drizzle } from 'drizzle-orm/d1';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cache } from 'react';
import * as schema from './schema';

// Cache the database connection for React components
export const getDb = () => {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema });
};

// Async version for static routes (ISR/SSG)
export const getDbAsync = async () => {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
};

// Export schema types
export * from './schema';