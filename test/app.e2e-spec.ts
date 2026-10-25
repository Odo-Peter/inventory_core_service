import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestContext } from './helpers/test-app.js';

describe('Application bootstrap (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  it('serves the versioned root route publicly', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/api/v1')
      .expect(200);

    expect(response.text).toBe('Hello Inventory!');
  });

  it('serves health without authentication', async () => {
    await request(context.app.getHttpServer()).get('/health/live').expect(200);
  });

  it('publishes Swagger with bearer authentication', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(response.body.components.securitySchemes).toHaveProperty('bearer');
    expect(response.body.info.title).toBe(
      'Stocktake store Inventory & POS API',
    );
  });

  it('returns 404 for unknown routes', async () => {
    await request(context.app.getHttpServer())
      .get('/api/v1/unknown')
      .expect(404);
  });
});
