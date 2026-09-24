import type { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../metrics.js';
import { normalizeRouteLabel } from '../metrics/cardinality.js';

/**
 * Normalise the matched route so cardinality stays bounded.
 *
 * Prefers the Express route template when available. Falls back to the raw
 * path only after running it through {@link normalizeRouteLabel}, which
 * buckets UUIDs, numeric ids, Stellar addresses, and other high-cardinality
 * segments so path parameters cannot grow the Prometheus series set without
 * limit.
 *
 * @see docs/observability/metric-cardinality.md
 */
export function resolveRoute(req: Request): string {
  const raw = req.route?.path
    ? `${req.baseUrl}${req.route.path}`
    : (req.originalUrl.split('?')[0] ?? req.originalUrl);

  // Collapse trailing slash to keep label cardinality predictable,
  // but preserve the bare root path "/".
  const collapsed =
    raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;

  // Express route templates already use `:param` placeholders — leave them.
  // Unmatched / fallback paths may contain real ids; bucket those.
  if (req.route?.path) {
    return collapsed.length > 1 && collapsed.endsWith('/')
      ? collapsed.slice(0, -1)
      : collapsed;
  }

  return normalizeRouteLabel(collapsed);
}

/**
 * Express middleware that records per-request metrics.
 *
 * Captures:
 * - `http_requests_total` counter (method, route, status_code)
 * - `http_request_duration_seconds` histogram (method, route, status_code)
 *
 * Must be mounted **before** route handlers so the `finish` listener
 * fires after the response has been fully written.
 */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    const route = resolveRoute(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSec);
  });

  next();
}
