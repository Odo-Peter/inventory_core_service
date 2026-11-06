import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ItemUnit } from '../src/modules/catalog/item-unit.enum.js';
import { createTestApp, type TestContext } from './helpers/test-app.js';

interface OpenApiParameter {
  name: string;
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  responses: Record<
    string,
    {
      content?: {
        'application/json'?: {
          schema?: {
            properties?: Record<string, { type?: string; $ref?: string }>;
          };
        };
      };
    }
  >;
}

describe('API documentation (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  it('documents page-based pagination for every converted endpoint', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    for (const path of ['/api/v1/shifts', '/api/v1/audit-logs']) {
      const operation = response.body.paths[path].get as OpenApiOperation;
      const parameters = (operation.parameters ?? []).map(
        (parameter) => parameter.name,
      );

      expect(parameters).toEqual(expect.arrayContaining(['page', 'page_size']));
      expect(parameters).not.toEqual(
        expect.arrayContaining(['cursor', 'limit']),
      );

      const schema =
        operation.responses['200'].content?.['application/json']?.schema;
      expect(schema?.properties?.data?.type).toBe('array');
      expect(schema?.properties?.meta?.$ref).toContain('PageMetaDto');
    }

    expect(
      response.body.components.schemas.PageMetaDto.properties,
    ).toMatchObject({
      page: { type: 'number' },
      page_size: { type: 'number' },
      total: { type: 'number' },
      total_pages: { type: 'number' },
    });
  });

  it('documents the ItemUnit enum on create and update schemas', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const schemas = response.body.components.schemas;

    expect(schemas.ItemUnit.enum).toEqual(Object.values(ItemUnit));

    for (const name of ['CreateItemDto', 'UpdateItemDto']) {
      expect(schemas[name], `${name} schema missing`).toBeDefined();
      expect(JSON.stringify(schemas[name].properties.unit)).toContain(
        '#/components/schemas/ItemUnit',
      );
    }
  });

  it('documents the create item request body with an image field', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const body = response.body.paths['/api/v1/items'].post.requestBody.content;
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['multipart/form-data', 'application/json']),
    );
    expect(JSON.stringify(body['multipart/form-data'].schema)).toContain(
      '#/components/schemas/CreateItemDto',
    );
    expect(response.body.components.schemas.CreateItemDto).toBeDefined();
  });
});
