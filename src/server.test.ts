import { assertEquals, assertExists } from 'jsr:@std/assert';
import { app } from './server.ts';

async function makeRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: BodyInit,
) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Authorization': 'Bearer test-token',
      ...headers,
    },
    body,
  });

  return await app.fetch(req, {
    TURBO_API_TOKEN: 'test-token',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'minio',
    AWS_SECRET_ACCESS_KEY: 'minio123',
    S3_BUCKET_NAME: 'remote-cache',
    S3_ENDPOINT_URL: 'http://localhost:9000',
    PUBLIC_URL: 'http://localhost:1235',
  });
}

// POST /v8/artifacts/events tests
Deno.test('POST /v8/artifacts/events - Success', async () => {
  const events = [{
    sessionId: crypto.randomUUID(),
    source: 'REMOTE',
    hash: crypto.randomUUID(),
    event: 'HIT',
    duration: 100,
  }];

  const response = await makeRequest(
    'POST',
    '/v8/artifacts/events',
    { 'Content-Type': 'application/json' },
    JSON.stringify(events),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
});

Deno.test('POST /v8/artifacts/events - Invalid Event', async () => {
  const events = [{
    sessionId: crypto.randomUUID(),
    source: 'REMOTE',
    hash: crypto.randomUUID(),
    event: 'HIT',
    // Missing duration for HIT event
  }];

  const response = await makeRequest(
    'POST',
    '/v8/artifacts/events',
    { 'Content-Type': 'application/json' },
    JSON.stringify(events),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Duration is required for HIT events');
});

// GET /v8/artifacts/status tests
Deno.test('GET /v8/artifacts/status - Success', async () => {
  const response = await makeRequest('GET', '/v8/artifacts/status');

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, 'enabled');
});

// PUT /v8/artifacts/{hash} tests
Deno.test('PUT /v8/artifacts/{hash} - Success', async () => {
  const hash = crypto.randomUUID();
  const testData = new TextEncoder().encode('test artifact data');

  const response = await makeRequest(
    'PUT',
    `/v8/artifacts/${hash}`,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': testData.length.toString(),
      'x-artifact-duration': '100',
      'x-artifact-tag': 'test-tag',
    },
    testData,
  );

  assertEquals(response.status, 202);
  const body = await response.json();
  assertExists(body.urls);
  assertEquals(body.urls[0], `http://localhost:1235/v8/artifacts/${hash}`);
});

Deno.test('PUT /v8/artifacts/{hash} - Invalid Content Length', async () => {
  const hash = crypto.randomUUID();
  const testData = new TextEncoder().encode('test artifact data');

  const response = await makeRequest(
    'PUT',
    `/v8/artifacts/${hash}`,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '0', // Invalid content length
    },
    testData,
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Invalid Content-Length');
});

// GET /v8/artifacts/{hash} tests
Deno.test('GET /v8/artifacts/{hash} - Success', async () => {
  const hash = crypto.randomUUID();
  const testData = new TextEncoder().encode('test artifact data');

  // First upload the artifact
  await makeRequest(
    'PUT',
    `/v8/artifacts/${hash}`,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': testData.length.toString(),
      'x-artifact-tag': 'test-tag',
    },
    testData,
  );

  // Then try to get it
  const response = await makeRequest('GET', `/v8/artifacts/${hash}`);

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get('Content-Type'),
    'application/octet-stream',
  );
  assertEquals(response.headers.get('x-artifact-tag'), 'test-tag');

  const body = await response.arrayBuffer();
  assertEquals(new Uint8Array(body), testData);
});

Deno.test('GET /v8/artifacts/{hash} - Not Found', async () => {
  const hash = crypto.randomUUID();
  const response = await makeRequest('GET', `/v8/artifacts/${hash}`);

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error, 'Artifact not found');
});

// HEAD /v8/artifacts/{hash} tests
Deno.test('HEAD /v8/artifacts/{hash} - Success', async () => {
  const hash = crypto.randomUUID();
  const testData = new TextEncoder().encode('test artifact data');

  // First upload the artifact
  await makeRequest(
    'PUT',
    `/v8/artifacts/${hash}`,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': testData.length.toString(),
      'x-artifact-tag': 'test-tag',
    },
    testData,
  );

  // Then check if it exists
  const response = await makeRequest('HEAD', `/v8/artifacts/${hash}`);

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get('Content-Length'),
    testData.length.toString(),
  );
  assertEquals(response.headers.get('x-artifact-tag'), 'test-tag');
});

Deno.test('HEAD /v8/artifacts/{hash} - Not Found', async () => {
  const hash = crypto.randomUUID();
  const response = await makeRequest('HEAD', `/v8/artifacts/${hash}`);

  assertEquals(response.status, 404);
  const body = await response.text();
  assertEquals(body, '');
});

// POST /v8/artifacts tests
Deno.test('POST /v8/artifacts - Success', async () => {
  const hash = crypto.randomUUID();
  const testData = new TextEncoder().encode('test artifact data');

  // First upload the artifact
  await makeRequest(
    'PUT',
    `/v8/artifacts/${hash}`,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': testData.length.toString(),
      'x-artifact-duration': '100',
      'x-artifact-tag': 'test-tag',
    },
    testData,
  );

  // Then query its information
  const response = await makeRequest(
    'POST',
    '/v8/artifacts',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ hashes: [hash] }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body[hash]);
  assertEquals(body[hash].size, testData.length);
  assertEquals(body[hash].taskDurationMs, 100);
  assertEquals(body[hash].tag, 'test-tag');
});

Deno.test('POST /v8/artifacts - Not Found', async () => {
  const hash = crypto.randomUUID();

  const response = await makeRequest(
    'POST',
    '/v8/artifacts',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ hashes: [hash] }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body[hash]);
  assertEquals(body[hash].error.message, 'Artifact not found');
});
