import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { bearerAuth } from 'npm:hono/bearer-auth';
import { logger } from 'npm:hono/logger';
import { Context } from 'npm:hono/context';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner';

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

// Configure S3 client
const s3Client = new S3Client({
  region: Deno.env.get('AWS_REGION') || 'us-east-1',
  credentials: {
    accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY')!,
  },
});

const BUCKET_NAME = Deno.env.get('S3_BUCKET_NAME')!;

// Create a new Hono app
const app = new Hono();

// Add middleware
app.use(logger());
app.use(cors());
app.use(
  bearerAuth({ token: Deno.env.get('TURBO_API_TOKEN')! }),
);

// POST /v8/artifacts/events
app.post('/v8/artifacts/events', async (c: Context) => {
  try {
    const events = await c.req.json<ArtifactEvent[]>();

    // Validate events
    for (const event of events) {
      if (!event.sessionId || !event.source || !event.hash || !event.event) {
        return c.json({ error: 'Invalid event data' }, 400);
      }

      if (event.event === 'HIT' && event.duration === undefined) {
        return c.json({ error: 'Duration is required for HIT events' }, 400);
      }
    }

    console.log(`Processed ${events.length} artifact events`);
    return c.json({ success: true });
  } catch (error) {
    console.error('Error processing artifact events:', error);
    return c.json({ error: 'Failed to process events' }, 400);
  }
});

// GET /v8/artifacts/status
app.get('/v8/artifacts/status', (c: Context) => {
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

    const artifactData = await c.req.arrayBuffer();

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `artifacts/${hash}`,
      Body: new Uint8Array(artifactData),
      ContentLength: contentLength,
      Metadata: {
        duration: duration.toString(),
        ...(tag ? { tag } : {}),
      },
    });

    await s3Client.send(command);

    // Generate a signed URL for the artifact
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `artifacts/${hash}`,
    });

    const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

    const response: ArtifactUploadResponse = {
      urls: [url],
    };

    return c.json(response, 202);
  } catch (error) {
    console.error('Error uploading artifact:', error);
    return c.json({ error: 'Failed to upload artifact' }, 400);
  }
});

// GET /v8/artifacts/{hash}
app.get('/v8/artifacts/:hash', async (c: Context) => {
  try {
    const hash = c.req.param('hash');

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `artifacts/${hash}`,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return c.json({ error: 'Artifact not found' }, 404);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': response.ContentLength?.toString() || '0',
    };

    if (response.Metadata?.tag) {
      headers['x-artifact-tag'] = response.Metadata.tag;
    }

    return new Response(
      c.req.method === 'HEAD' ? null : response.Body as ReadableStream,
      { headers },
    );
  } catch (error) {
    console.error('Error downloading artifact:', error);
    return c.json({ error: 'Artifact not found' }, 404);
  }
});

// POST /v8/artifacts
app.post('/v8/artifacts', async (c: Context) => {
  try {
    const { hashes } = await c.req.json<ArtifactQueryRequest>();

    if (!Array.isArray(hashes)) {
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const response: ArtifactQueryResponse = {};

    for (const hash of hashes) {
      try {
        const command = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `artifacts/${hash}`,
        });

        const result = await s3Client.send(command);

        response[hash] = {
          size: result.ContentLength || 0,
          taskDurationMs: parseInt(result.Metadata?.duration || '0'),
          tag: result.Metadata?.tag,
        };
      } catch (error) {
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
