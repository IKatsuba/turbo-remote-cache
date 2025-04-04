# Turborepo Remote Cache Server

A Deno-based implementation of the Turborepo Remote Cache API that uses AWS S3
as a storage backend. This server provides a remote caching solution for
Turborepo builds, allowing teams to share build artifacts and significantly
speed up their build processes.

## Features

- Implements the complete Turborepo Remote Cache API specification
- Uses AWS S3 for artifact storage
- Supports team-based artifact isolation
- Provides secure access through bearer token authentication
- Implements all required endpoints:
  - POST /v8/artifacts/events - Record cache usage events (just mock)
  - GET /v8/artifacts/status - Check Remote Caching status
  - PUT /v8/artifacts/{hash} - Upload cache artifacts
  - GET /v8/artifacts/{hash} - Download cache artifacts
  - HEAD /v8/artifacts/{hash} - Check if a cache artifact exists
  - POST /v8/artifacts - Query information about artifacts

## Prerequisites

- [Deno](https://deno.land/) (version 1.30.0 or higher)
- S3 bucket and credentials with appropriate permissions

## Environment Variables

The following environment variables are required:

```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=your_region (defaults to us-east-1)
S3_BUCKET_NAME=your_bucket_name
S3_ENDPOINT_URL=your_s3_endpoint_url (optional, defaults to AWS default endpoint)

# Server Configuration
TURBO_API_TOKEN=your_api_token
PORT=1235 (optional, defaults to 1235)
PUBLIC_URL=http://localhost:1235 (optional, defaults to http://localhost:1235)
```

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/turbo-remote-cache.git
cd turbo-remote-cache
```

2. Set up environment variables:

```bash
cp .env.local .env
# Edit .env with your configuration
```

## Running the Server

Start the server with the following command:

```bash
deno task start
```

The server will start on the specified port (default: 1235).

## Usage with Turborepo

1. Configure your Turborepo project to use the remote cache:

```bash
npx turbo login
```

2. Set the remote cache URL:

```bash
npx turbo link
```

3. When prompted, enter your server URL and API token.

4. Start using remote caching in your builds:

```bash
npx turbo build --remote-only
```

## API Documentation

The server implements the
[Turborepo Remote Cache API specification](https://turbo.build/repo/docs/core-concepts/remote-caching).
For detailed API documentation, refer to the OpenAPI specification in
`spec.json`.

## Development

### Running Tests

Before running tests, you need to run docker compose to start the local s3
server.

```bash
docker compose up -d
```

Then you can run the tests:

```bash
deno task test
```

### Code Structure

- `src/server.ts` - Main server implementation
- `src/server.test.ts` - Test suite
- `spec.json` - OpenAPI specification

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.

## Acknowledgments

- [Turborepo](https://turbo.build/repo) for the remote caching specification
- [Deno](https://deno.land/) for the runtime
- [Hono](https://hono.dev/) for the web framework
- [AWS SDK](https://aws.amazon.com/sdk-for-javascript/) for S3 integration
