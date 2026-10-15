import { NextResponse } from 'next/server';
import { modelSchema } from '@/lib/schema';
import { apiPathCandidates, probeModelsUrl } from '@/lib/api-path';

/**
 * Probe an OpenAI-compatible API for the models list using a raw fetch so we
 * can detect Cloudflare challenge pages (which the OpenAI SDK would silently
 * turn into a generic parse error) and surface a recognizable error message.
 * Path probing (root first, then /v1) is shared with the browser-direct path.
 */
async function fetchModelsRaw(
  baseUrl: string,
  apiKey: string,
): Promise<{ models: Array<{ id: string; object?: string }> } | { cfUrl: string }> {
  for (const { url } of apiPathCandidates(baseUrl)) {
    const probe = await probeModelsUrl(url, apiKey, undefined, 30 * 1000);

    // Cloudflare challenge / bot-protection page — tell the client so it can
    // offer the manual verification dialog.
    if (probe.cfUrl) {
      return { cfUrl: probe.cfUrl };
    }
    if (probe.ok && probe.models) {
      return { models: probe.models };
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
