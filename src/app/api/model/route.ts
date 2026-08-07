import { NextResponse } from 'next/server';
import { modelSchema } from '@/lib/schema';
import OpenAI from 'openai';

export async function POST(request: Request) {
  let baseUrl = '';
  try {
    const body = await request.json();
    
    // Validate input
    const validatedData = modelSchema.parse(body);
    baseUrl = validatedData.baseUrl;
    
    // Create OpenAI client with timeout to prevent indefinite hanging
    const openai = new OpenAI({
      apiKey: validatedData.apiKey,
      baseURL: validatedData.baseUrl,
      timeout: 30 * 1000, // 30s timeout for model listing
      maxRetries: 1,
    });

    // Get available models to verify if the selected model is available
    const modelsResponse = await openai.models.list();

    return NextResponse.json(
      { models: modelsResponse.data },
      { status: 200 }
    );
  } catch (error) {
    console.error('Model fetch error:', error);
    
    // Provide more helpful error messages for common issues
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
