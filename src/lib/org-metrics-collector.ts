/**
 * Organization Metrics Collector
 * Periodically queries the database and updates Prometheus gauges
 * for organization-level monitoring (total orgs, members, quizzes per org).
 */

import { db, schema } from '../core/database/client';
import { eq, sql } from 'drizzle-orm';
import {
    organizationsTotal,
    organizationMembersTotal,
    organizationQuizzesTotal,
} from './metrics';

const COLLECTION_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Collects organization metrics from the database and updates Prometheus gauges.
 * Resets label-based gauges before each collection to avoid stale data from deleted orgs.
 */
async function collectOrgMetrics(): Promise<void> {
    try {
        // 1. Get all organizations
        const orgs = await db
            .select({
                id: schema.organizations.id,
                name: schema.organizations.name,
                subdomain: schema.organizations.subdomain,
            })
            .from(schema.organizations);

        // Update total organizations gauge
        organizationsTotal.set(orgs.length);

        // Reset label-based gauges to prevent stale data from deleted orgs
        organizationMembersTotal.reset();
        organizationQuizzesTotal.reset();

        // 2. For each organization, count members and quizzes
        for (const org of orgs) {
            // Member count
            const [memberResult] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.members)
                .where(eq(schema.members.orgId, org.id));

            organizationMembersTotal
                .labels(org.subdomain, org.name)
                .set(memberResult?.count ?? 0);

            // Quiz count (exclude soft-deleted)
            const [quizResult] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.quizzes)
                .where(eq(schema.quizzes.orgId, org.id));

            organizationQuizzesTotal
                .labels(org.subdomain, org.name)
                .set(quizResult?.count ?? 0);
        }
    } catch (error) {
        console.error('Failed to collect organization metrics:', error);
    }
}

/**
 * Starts the periodic organization metrics collector.
 * Runs an initial collection immediately, then at the configured interval.
 */
export function startOrgMetricsCollector(): void {
    // Initial collection
    collectOrgMetrics();

    // Periodic collection
    setInterval(collectOrgMetrics, COLLECTION_INTERVAL_MS);

    console.log(`📊 Organization metrics collector started (interval: ${COLLECTION_INTERVAL_MS / 1000}s)`);
}
