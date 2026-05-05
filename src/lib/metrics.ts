import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a Registry which registers the metrics
export const register = new Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
    app: 'arena-api'
});

// Enable the collection of default metrics
collectDefaultMetrics({ register });

// Define custom metrics
export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

export const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
    registers: [register]
});

export const activeRequests = new Gauge({
    name: 'active_requests',
    help: 'Number of active HTTP requests',
    registers: [register]
});

export const activeWebSocketConnections = new Gauge({
    name: 'active_websocket_connections',
    help: 'Number of active WebSocket connections',
    registers: [register]
});

export const activePollingConnections = new Gauge({
    name: 'active_polling_connections',
    help: 'Number of active HTTP polling sessions',
    registers: [register]
});

export const websocketConnectionsOpenedTotal = new Counter({
    name: 'websocket_connections_opened_total',
    help: 'Total number of opened WebSocket connections',
    labelNames: ['platform'],
    registers: [register]
});

export const websocketConnectionsClosedTotal = new Counter({
    name: 'websocket_connections_closed_total',
    help: 'Total number of closed WebSocket connections',
    labelNames: ['platform', 'close_code'],
    registers: [register]
});

export const websocketMessageErrorsTotal = new Counter({
    name: 'websocket_message_errors_total',
    help: 'Total number of WebSocket message processing errors',
    labelNames: ['platform', 'error_type'],
    registers: [register]
});

// ─── ORGANIZATION METRICS ──────────────────────────────

export const organizationsTotal = new Gauge({
    name: 'arena_organizations_total',
    help: 'Total number of organizations',
    registers: [register]
});

export const organizationMembersTotal = new Gauge({
    name: 'arena_organization_members_total',
    help: 'Number of members per organization',
    labelNames: ['org_subdomain', 'org_name'],
    registers: [register]
});

export const organizationQuizzesTotal = new Gauge({
    name: 'arena_organization_quizzes_total',
    help: 'Number of quizzes per organization',
    labelNames: ['org_subdomain', 'org_name'],
    registers: [register]
});
