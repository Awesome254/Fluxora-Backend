import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import * as logger from '../../src/utils/logger.js';

const ADMIN_KEY = 'test-metrics-admin-key';

describe('GET /metrics auth', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.ADMIN_API_KEY = originalKey;
    } else {
      delete process.env.ADMIN_API_KEY;
    }
    vi.restoreAllMocks();
  });

  it('returns 401 and logs warning when Authorization header is missing', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(401);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Admin authorization refused — missing Authorization header'),
      expect.objectContaining({
        path: '/metrics',
        method: 'GET',
      })
    );
  });

  it('returns 401 and logs warning when Authorization header is not Bearer scheme', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await request(app).get('/metrics').set('Authorization', `Basic ${ADMIN_KEY}`);
    expect(res.status).toBe(401);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Admin authorization refused — invalid Authorization header scheme'),
      expect.objectContaining({
        path: '/metrics',
        method: 'GET',
      })
    );
  });

  it('returns 403 and logs warning when Bearer token is invalid without leaking credentials', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const invalidToken = 'wrong-token-abc';
    const res = await request(app).get('/metrics').set('Authorization', `Bearer ${invalidToken}`);
    expect(res.status).toBe(403);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Admin authorization refused — invalid admin credentials'),
      expect.objectContaining({
        path: '/metrics',
        method: 'GET',
      })
    );

    for (const call of warnSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(invalidToken);
      expect(serialized).not.toContain(ADMIN_KEY);
    }
  });

  it('returns 200 with metrics body when token is valid', async () => {
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('# HELP');
  });

  it('returns 503 and logs warning when ADMIN_API_KEY is not configured', async () => {
    delete process.env.ADMIN_API_KEY;
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(503);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Admin authorization refused — ADMIN_API_KEY is not configured'),
      expect.objectContaining({
        path: '/metrics',
        method: 'GET',
      })
    );
  });

  it('ensures no high-cardinality label exposes per-user data in the scraped metrics payload', async () => {
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${ADMIN_KEY}`);

    expect(res.status).toBe(200);
    const metricsText = res.text;

    // No Stellar public key addresses (G followed by 55 alphanumeric characters)
    expect(metricsText).not.toMatch(/G[A-Z0-9]{55}/);

    // No email addresses
    expect(metricsText).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // No raw secret tokens
    expect(metricsText).not.toContain(ADMIN_KEY);
  });

  it('health endpoint remains unauthenticated', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
