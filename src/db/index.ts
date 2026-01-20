import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:cok_gizli_sifre@postgres:5432/arena_db';

// Create postgres connection
const queryClient = postgres(DATABASE_URL);

// Create drizzle instance
export const db = drizzle(queryClient, { schema });

// Export schema for easy access
export { schema };
