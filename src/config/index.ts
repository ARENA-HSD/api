// Central configuration exports
export * from '../core/database/client';
export * from '../middleware/auth.middleware';

// Environment variables (from index.ts)
export const config = {
    database: {
        url: process.env.DATABASE_URL!,
    },
    redis: {
        url: process.env.REDIS_URL!,
    },
    jwt: {
        secret: process.env.JWT_SECRET!,
    },
    app: {
        port: parseInt(process.env.PORT || '3000'),
        env: process.env.NODE_ENV || 'development',
    }
} as const;
