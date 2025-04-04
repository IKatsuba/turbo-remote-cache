import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { bearerAuth } from 'npm:hono/bearer-auth';
import { logger } from 'npm:hono/logger';
import { Context } from 'npm:hono/context';

// Define types based on the OpenAPI spec
interface ArtifactEvent {
  sessionId: string;
  source: 'LOCAL' | 'REMOTE';
  hash: string;
  event: 'HIT' | 'MISS';
  duration?: number;
}

interface ArtifactQueryRequest {
  hashes: string[];
}

interface ArtifactQueryResponse {
  [hash: string]: {
    size: number;
    taskDurationMs: number;
    tag?: string;
  } | {
    error: {
      message: string;
    };
  } | null;
}

interface ArtifactStatusResponse {
  status: 'disabled' | 'enabled' | 'over_limit' | 'paused';
}

interface ArtifactUploadResponse {
  urls: string[];
}

// Create a new Hono app
const app = new Hono();

// Add middleware
app.use(logger());
app.use(cors());
app.use(
  bearerAuth({ token: Deno.env.get('TURBO_API_TOKEN')! }),
);

// In-memory storage for artifacts (replace with actual storage in production)
const artifactStorage: Record<string, Uint8Array> = {};
const artifactMetadata: Record<string, { size: number; tag?: string }> = {};

// POST /v8/artifacts/events
app.post('/v8/artifacts/events', async (c: Context) => {
  try {
    const events = await c.req.json() as ArtifactEvent[];

    // Validate events
    for (const event of events) {
      if (!event.sessionId || !event.source || !event.hash || !event.event) {
        return c.json({ error: 'Invalid event data' }, 400);
      }

      // If event is HIT and duration is not provided, return 400
      if (event.event === 'HIT' && event.duration === undefined) {
        return c.json({ error: 'Duration is required for HIT events' }, 400);
      }
    }

    // Process events (in a real implementation, you would store these events)
    console.log(`Processed ${events.length} artifact events`);

    return c.json({ success: true });
  } catch (error) {
    console.error('Error processing artifact events:', error);
    return c.json({ error: 'Failed to process events' }, 400);
  }
});

// GET /v8/artifacts/status
app.get('/v8/artifacts/status', (c: Context) => {
  // In a real implementation, you would check the actual status
  const response: ArtifactStatusResponse = {
    status: 'enabled',
  };

  return c.json(response);
});

// PUT /v8/artifacts/{hash}
app.put('/v8/artifacts/:hash', async (c: Context) => {
  try {
    const hash = c.req.param('hash');
    const contentLength = parseInt(c.req.header('Content-Length') || '0');
    const duration = parseInt(c.req.header('x-artifact-duration') || '0');
    const tag = c.req.header('x-artifact-tag');

    if (contentLength <= 0) {
      return c.json({ error: 'Invalid Content-Length' }, 400);
    }

    // Read the artifact data
    const artifactData = await c.req.arrayBuffer();

    // Store the artifact
    artifactStorage[hash] = new Uint8Array(artifactData);
    artifactMetadata[hash] = {
      size: contentLength,
      tag,
    };

    // Return the URLs where the artifact was stored
    const response: ArtifactUploadResponse = {
      urls: [`https://api.vercel.com/v2/now/artifact/${hash}`],
    };

    return c.json(response, 202);
  } catch (error) {
    console.error('Error uploading artifact:', error);
    return c.json({ error: 'Failed to upload artifact' }, 400);
  }
});

// GET /v8/artifacts/{hash}
app.get('/v8/artifacts/:hash', (c: Context) => {
  const hash = c.req.param('hash');

  // Check if the artifact exists
  if (!artifactStorage[hash]) {
    return c.json({ error: 'Artifact not found' }, 404);
  }

  // Set headers
  c.header('Content-Type', 'application/octet-stream');
  c.header('Content-Length', artifactMetadata[hash].size.toString());

  if (artifactMetadata[hash].tag) {
    c.header('x-artifact-tag', artifactMetadata[hash].tag);
  }

  // Return the artifact data
  return new Response(c.req.method === 'HEAD' ? null : artifactStorage[hash], {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': artifactMetadata[hash].size.toString(),
      ...(artifactMetadata[hash].tag
        ? { 'x-artifact-tag': artifactMetadata[hash].tag }
        : {}),
    },
  });
});

// POST /v8/artifacts
app.post('/v8/artifacts', async (c: Context) => {
  try {
    const { hashes } = await c.req.json() as ArtifactQueryRequest;

    if (!Array.isArray(hashes)) {
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const response: ArtifactQueryResponse = {};

    // Query information about each artifact
    for (const hash of hashes) {
      if (artifactStorage[hash]) {
        response[hash] = {
          size: artifactMetadata[hash].size,
          taskDurationMs: 0, // This would be stored in a real implementation
          tag: artifactMetadata[hash].tag,
        };
      } else {
        response[hash] = {
          error: {
            message: 'Artifact not found',
          },
        };
      }
    }

    return c.json(response);
  } catch (error) {
    console.error('Error querying artifacts:', error);
    return c.json({ error: 'Failed to query artifacts' }, 400);
  }
});

// Start the server
const port = parseInt(Deno.env.get('PORT') || '1235');

Deno.serve({
  port,
  handler: app.fetch,
  onListen({ port }) {
    console.log(`Server running on http://localhost:${port}`);
  },
});
