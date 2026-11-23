/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { api } from './api.ts';

void describe('API Surface Verification (Prompt 18 PRD Alignment)', () => {
  void it('has exactly three game API routes mounted under /api (/daily, /complete, /share)', () => {
    // In Hono, routes are registered in api.routes
    const routeDefinitions = api.routes.map((r) => ({
      path: r.path,
      method: r.method,
    }));

    // Find all distinct paths
    const paths = Array.from(new Set(routeDefinitions.map((r) => r.path))).sort();

    assert.deepStrictEqual(
      paths,
      ['/complete', '/daily', '/share'],
      'API surface must contain exactly /daily, /complete, and /share'
    );
  });

  void it('does not expose starter template routes (/init, /increment, /decrement)', async () => {
    const initRes = await api.request('/init', { method: 'GET' });
    assert.strictEqual(initRes.status, 404, '/init must return 404 Not Found');

    const incrRes = await api.request('/increment', { method: 'POST' });
    assert.strictEqual(incrRes.status, 404, '/increment must return 404 Not Found');

    const decrRes = await api.request('/decrement', { method: 'POST' });
    assert.strictEqual(decrRes.status, 404, '/decrement must return 404 Not Found');
  });
});

