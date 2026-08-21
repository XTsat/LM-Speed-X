import { NextResponse } from 'next/server';
import { modelSchema } from '@/lib/schema';
import { isCloudflareError } from '@/lib/cloudflare';

/**
 * Probe an OpenAI-compatible API for the models list using a raw fetch so we
 * can detect Cloudflare challenge pages (which the OpenAI SDK would silently
 * turn into a generic parse error) and surface a recognizable error message.
 */
async function fetchModelsRaw(
  baseUrl: string,
  apiKey: string,
): Promise<{ models: Array<{ id: string; object?: string }> } | { cfUrl: string }> {
  const normalized = baseUrl.replace(/\/+$/, '');
  const attempts = [
    { path: '', url: `${normalized}/models` },
    { path: '/v1', url: `${normalized}/v1/models` },
  ];

  for (const { path, url } of attempts) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30 * 1000),
      });
    } catch {
      continue;
    }

    const body = await response.text().catch(() => '');
    const contentType = response.headers.get('content-type') || '';

    // Cloudflare challenge / bot-protection page — tell the client so it can
    // offer the manual verification dialog.
    if (!contentType.includes('application/json') || isCloudflareError(body) || response.status === 403) {
      if (isCloudflareError(body)) {
        return { cfUrl: url };
      }
      continue;
    }

    try {
      const data = JSON.parse(body);
      const models = Array.isArray(data) ? data : data.data;
      if (Array.isArray(models) && models.length > 0 && models[0]?.id) {
        return { models: models.filter((m: { id: string }) => m && typeof m.id === 'string') };
      }
    } catch {
      // not JSON — try next candidate
    }
  }

  throw new Error('Model list not found. The URL may be incorrect or the service does not expose an OpenAI-compatible /models endpoint.');
}

export async function POST(request: Request) {
  let baseUrl = '';
  try {
    const body = await request.json();

    // Validate input
    const validatedData = modelSchema.parse(body);

    baseUrl = validatedData.baseUrl;
    const result = await fetchModelsRaw(validatedData.baseUrl, validatedData.apiKey);

    if ('cfUrl' in result) {
      return NextResponse.json(
        {
          error: `Cloudflare challenge detected at ${result.cfUrl}. Please verify manually (browser direct).`,
          cfUrl: result.cfUrl,
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { models: result.models },
      { status: 200 }
    );
  } catch (error) {
    console.error('Model fetch error:', error);

    let errorMessage = error instanceof Error ? error.message : 'Unknown error';
    let statusCode = 400;

    // Detect timeout/connection errors and give actionable diagnostics
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
        errorMessage = `Request timed out connecting to the API endpoint. This may be caused by:
- The API server is unreachable from the deployed server (check network/firewall)
- The API server is too slow to respond
- The base URL is incorrect or the service is down`;
        statusCode = 504;
      } else if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('connection')) {
        const target = baseUrl || 'the specified URL';
        errorMessage = `Cannot connect to ${target}. Please verify:
- The URL is correct and accessible from the server
- The service is running and accepting connections
- No firewall/proxy is blocking the request`;
        statusCode = 502;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}
