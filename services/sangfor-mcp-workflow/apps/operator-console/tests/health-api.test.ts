import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Express } from 'express';
import healthRoutes from '../src/routes/health.routes.js';
import { apiKeyAuth } from '../src/middleware/auth.js';

type RequestOptions = {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly apiKey?: string;
  readonly body?: unknown;
};

type TestResponse = {
  readonly status: number;
  readonly body: unknown;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestApp(app: Express, options: RequestOptions): Promise<TestResponse> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Test server did not expose a TCP port');
  }

  try {
    const headers = new Headers();
    if (options.apiKey) headers.set('x-api-key', options.apiKey);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(`http://127.0.0.1:${address.port}${options.path}`, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('Health Check API', () => {
  const API_KEY = 'test-api-key';
  const previousApiKey = process.env.SANGFOR_API_KEY;
  const previousPrincipalId = process.env.SANGFOR_OPERATOR_PRINCIPAL_ID;
  let app: Express;
  
  beforeAll(() => {
    process.env.SANGFOR_API_KEY = 'test-api-key';
    process.env.SANGFOR_OPERATOR_PRINCIPAL_ID = 'health-test-operator';
    app = express();
    app.use(express.json());
    app.use('/api/devices/health', apiKeyAuth, healthRoutes);
  });

  afterAll(() => {
    if (previousApiKey === undefined) {
      delete process.env.SANGFOR_API_KEY;
    } else {
      process.env.SANGFOR_API_KEY = previousApiKey;
    }
    if (previousPrincipalId === undefined) {
      delete process.env.SANGFOR_OPERATOR_PRINCIPAL_ID;
    } else {
      process.env.SANGFOR_OPERATOR_PRINCIPAL_ID = previousPrincipalId;
    }
  });

  describe('GET /api/devices/health', () => {
    it('should return device list', async () => {
      const res = await requestApp(app, {
        method: 'GET',
        path: '/api/devices/health',
        apiKey: API_KEY,
      });
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (!Array.isArray(res.body)) throw new TypeError('Expected a response array');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should return 401 without API key', async () => {
      const res = await requestApp(app, {
        method: 'GET',
        path: '/api/devices/health',
      });
      
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid API key', async () => {
      const res = await requestApp(app, {
        method: 'GET',
        path: '/api/devices/health',
        apiKey: 'invalid-key',
      });
      
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/devices/health/:id', () => {
    it('should return device detail', async () => {
      const res = await requestApp(app, {
        method: 'GET',
        path: '/api/devices/health/epp-1',
        apiKey: API_KEY,
      });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 'epp-1');
      expect(res.body).toHaveProperty('cpu');
      expect(res.body).toHaveProperty('memory');
      expect(res.body).toHaveProperty('disk');
    });

    it('should return 404 for non-existent device', async () => {
      const res = await requestApp(app, {
        method: 'GET',
        path: '/api/devices/health/non-existent',
        apiKey: API_KEY,
      });
      
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/devices/health/check', () => {
    it('should check devices', async () => {
      const res = await requestApp(app, {
        method: 'POST',
        path: '/api/devices/health/check',
        apiKey: API_KEY,
        body: { deviceIds: ['epp-1', 'iag-1'] },
      });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('results');
      if (!isRecord(res.body)) throw new TypeError('Expected a response object');
      expect(res.body.results).toHaveLength(2);
    });

    it('should return 400 for invalid input', async () => {
      const res = await requestApp(app, {
        method: 'POST',
        path: '/api/devices/health/check',
        apiKey: API_KEY,
        body: { deviceIds: 'invalid' },
      });
      
      expect(res.status).toBe(400);
    });

    it('should return 400 for empty array', async () => {
      const res = await requestApp(app, {
        method: 'POST',
        path: '/api/devices/health/check',
        apiKey: API_KEY,
        body: { deviceIds: [] },
      });
      
      expect(res.status).toBe(400);
    });
  });
});
