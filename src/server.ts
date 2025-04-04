import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { bearerAuth } from 'npm:hono/bearer-auth';
import { logger } from 'npm:hono/logger';
import { Context } from 'npm:hono';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3';

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

export const app = new Hono<{
  Bindings: {
    TURBO_API_TOKEN: string;
    S3_BUCKET_NAME: string;
    AWS_REGION: string;
    AWS_ACCESS_KEY_ID: string;
    AWS_SECRET_ACCESS_KEY: string;
    S3_ENDPOINT_URL: string;
    PUBLIC_URL: string;
  };
  Variables: {
    s3: S3Client;
    team: string;
  };
}>();

app.use(logger());
app.use(cors());
app.use(
  (c, next) => bearerAuth({ token: c.env.TURBO_API_TOKEN })(c, next),
);
app.use(async (c, next) => {
  const teamId = c.req.query('teamId');
  const slug = c.req.query('slug');

  if (!teamId && !slug) {
    return c.json({ error: 'Either teamId or slug must be provided' }, 400);
  }

  c.set('team', teamId || slug!);

  await next();
});

app.use(async (c, next) => {
  c.set(
    's3',
    new S3Client({
      region: c.env.AWS_REGION,
      endpoint: c.env.S3_ENDPOINT_URL,
      credentials: {
        accessKeyId: c.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: c.env.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    }),
  );

  await next();
});

// POST /v8/artifacts/events
app.post('/v8/artifacts/events', async (c: Context) => {
  try {
    const teamIdentifier = c.get('team');
    const events = await c.req.json<ArtifactEvent[]>();

    for (const event of events) {
      if (!event.sessionId || !event.source || !event.hash || !event.event) {
        return c.json({ error: 'Invalid event data' }, 400);
      }

      if (event.event === 'HIT' && event.duration === undefined) {
        return c.json({ error: 'Duration is required for HIT events' }, 400);
      }
    }

    console.log(
      `Processed ${events.length} artifact events for team ${teamIdentifier}`,
    );
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
    const teamIdentifier = c.get('team');
    const hash = c.req.param('hash');
    const contentLength = parseInt(c.req.header('Content-Length') || '0');
    const duration = parseInt(c.req.header('x-artifact-duration') || '0');
    const tag = c.req.header('x-artifact-tag');

    if (contentLength <= 0) {
      return c.json({ error: 'Invalid Content-Length' }, 400);
    }

    const artifactData = await c.req.arrayBuffer();

    const command = new PutObjectCommand({
      Bucket: c.env.S3_BUCKET_NAME,
      Key: `artifacts/${teamIdentifier}/${hash}`,
      Body: new Uint8Array(artifactData),
      ContentLength: contentLength,
      Metadata: {
        duration: duration.toString(),
        ...(tag ? { tag } : {}),
      },
    });

    await c.get('s3').send(command);

    const response: ArtifactUploadResponse = {
      urls: [
        `${c.env.PUBLIC_URL}/v8/artifacts/${hash}?teamId=${teamIdentifier}`,
      ],
    };

    return c.json(response, 202);
  } catch (error) {
    console.error('Error uploading artifact:', error);
    return c.json({ error: 'Failed to upload artifact' }, 500);
  }
});

// GET /v8/artifacts/{hash}
app.get('/v8/artifacts/:hash', async (c: Context) => {
  try {
    const teamIdentifier = c.get('team');
    const hash = c.req.param('hash');

    const command = new GetObjectCommand({
      Bucket: c.env.S3_BUCKET_NAME,
      Key: `artifacts/${teamIdentifier}/${hash}`,
    });

    const response = await c.get('s3').send(command);

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
    const teamIdentifier = c.get('team');
    const { hashes } = await c.req.json<ArtifactQueryRequest>();

    if (!Array.isArray(hashes)) {
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const response: ArtifactQueryResponse = {};

    for (const hash of hashes) {
      try {
        const command = new HeadObjectCommand({
          Bucket: c.env.S3_BUCKET_NAME,
          Key: `artifacts/${teamIdentifier}/${hash}`,
        });

        const result = await c.get('s3').send(command);

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
    return c.json({ error: 'Failed to query artifacts' }, 500);
  }
});

if (import.meta.main) {
  const port = parseInt(Deno.env.get('PORT') || '1235');

  Deno.serve({
    port,
    handler: (req) =>
      app.fetch(req, {
        NX_CACHE_ACCESS_TOKEN: Deno.env.get('NX_CACHE_ACCESS_TOKEN'),
        AWS_REGION: Deno.env.get('AWS_REGION') || 'us-east-1',
        AWS_ACCESS_KEY_ID: Deno.env.get('AWS_ACCESS_KEY_ID'),
        AWS_SECRET_ACCESS_KEY: Deno.env.get('AWS_SECRET_ACCESS_KEY'),
        S3_BUCKET_NAME: Deno.env.get('S3_BUCKET_NAME') || 'remote-cache',
        S3_ENDPOINT_URL: Deno.env.get('S3_ENDPOINT_URL') ||
          'http://localhost:9000',
        PUBLIC_URL: Deno.env.get('PUBLIC_URL') || 'http://localhost:1235',
      }),
    onListen({ port }) {
      console.log(`Server running on http://localhost:${port}`);
    },
  });
}
