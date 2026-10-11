import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer } from '../src/app.js';

describe('same-origin console hosting', () => {
  const pool = new Pool({ connectionString: 'postgresql://mandate:mandate@127.0.0.1:1/mandate', connectionTimeoutMillis: 100 });
  let app: FastifyInstance;
  let staticDir: string;

  beforeAll(async () => {
    staticDir = await mkdtemp(join(tmpdir(), 'mandate-console-'));
    await mkdir(join(staticDir, 'assets'));
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Mandate demo</title>');
    await writeFile(join(staticDir, 'assets', 'app.js'), 'globalThis.mandateDemo = true;');
    app = await createApiServer({
      pool,
      jwksUrl: 'http://127.0.0.1:1/.well-known/jwks.json',
      issuer: 'https://identity.example.test/',
      audience: 'mandate-api-test',
      consoleStaticDir: staticDir,
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
    if (staticDir !== undefined) await rm(staticDir, { recursive: true, force: true });
  });

  it('serves the built console at the existing API origin', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<title>Mandate demo</title>');
  });

  it('serves generated frontend assets', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('mandateDemo');
  });

  it('falls back to the console entrypoint for client-side routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/app/policies' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Mandate demo</title>');
  });

  it('keeps missing API endpoints as JSON responses instead of SPA responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/not-a-route' });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toContain('<title>Mandate demo</title>');
  });
});
