import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/redis';
import { 
  hashApiKey, 
  ProxyRequestSchema, 
  SECURITY_HEADERS, 
  applySecurityHeaders 
} from '@/lib/security';
import { executeGuardrails } from '@/lib/guardrails';

// Force dynamic execution for API route
export const dynamic = 'force-dynamic';

interface ModelPricing {
  promptCostPerToken: number;
  completionCostPerToken: number;
}

// Pricing per token in USD
const PRICING_RULES: Record<string, ModelPricing> = {
  'gpt-4o': {
    promptCostPerToken: 0.000005,
    completionCostPerToken: 0.000015,
  },
  'gpt-4-turbo': {
    promptCostPerToken: 0.00001,
    completionCostPerToken: 0.00003,
  },
  'gpt-3.5-turbo': {
    promptCostPerToken: 0.0000005,
    completionCostPerToken: 0.0000015,
  },
  'claude-3-5-sonnet': {
    promptCostPerToken: 0.000003,
    completionCostPerToken: 0.000015,
  },
  'gemini-1.5-flash': {
    promptCostPerToken: 0.000000075,
    completionCostPerToken: 0.0000003,
  },
  'default': {
    promptCostPerToken: 0.000001,
    completionCostPerToken: 0.000003,
  }
};

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const modelKey = Object.keys(PRICING_RULES).find(key => model.toLowerCase().includes(key)) || 'default';
  const pricing = PRICING_RULES[modelKey];
  return (promptTokens * pricing.promptCostPerToken) + (completionTokens * pricing.completionCostPerToken);
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  // Fallback estimation: ~4 characters per token
  return Math.max(1, Math.ceil(text.length / 4));
}

// Helper to log telemetry asynchronously to Supabase
async function logTelemetry(logData: {
  tenant_id: string;
  request_path: string;
  request_method: string;
  prompt: string;
  response?: string;
  tokens_prompt: number;
  tokens_completion: number;
  tokens_total: number;
  cost_usd: number;
  latency_ms: number;
  status_code: number;
  is_blocked: boolean;
  blocked_by?: string | null;
  threat_type?: string | null;
  confidence?: number | null;
}) {
  try {
    const { error } = await supabaseAdmin.from('telemetry_logs').insert([logData]);
    if (error) {
      console.error('Supabase telemetry logging error:', error);
    }
  } catch (err) {
    console.error('Failed to log telemetry:', err);
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const headers = new Headers();
  applySecurityHeaders(headers);

  // 1. Authenticate Request via x-api-shield-key
  const apiKey = req.headers.get('x-api-shield-key');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized: Missing x-api-shield-key header' },
      { status: 401, headers }
    );
  }

  const hashedKey = hashApiKey(apiKey);
  const { data: tenant, error: dbError } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('api_key_hash', hashedKey)
    .single();

  if (dbError || !tenant) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid API key' },
      { status: 401, headers }
    );
  }

  // 2. Upstash Redis Rate Limiting
  const rateLimitResult = await checkRateLimit(tenant.id, tenant.rate_limit_rpm);
  
  // Apply rate limit headers
  headers.set('X-RateLimit-Limit', rateLimitResult.limit.toString());
  headers.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
  headers.set('X-RateLimit-Reset', rateLimitResult.reset.toString());

  if (!rateLimitResult.success) {
    const retryAfter = Math.max(1, Math.ceil((rateLimitResult.reset - Date.now()) / 1000));
    headers.set('Retry-After', retryAfter.toString());
    
    // Log the rate limit rejection telemetry
    const latency = Date.now() - startTime;
    await logTelemetry({
      tenant_id: tenant.id,
      request_path: '/api/v1/proxy',
      request_method: 'POST',
      prompt: 'Rate limited request',
      response: 'HTTP 429 Too Many Requests',
      tokens_prompt: 0,
      tokens_completion: 0,
      tokens_total: 0,
      cost_usd: 0,
      latency_ms: latency,
      status_code: 429,
      is_blocked: true,
      blocked_by: 'rate_limiter',
      threat_type: 'Rate Limit Exhaustion',
      confidence: 1.0,
    });

    return NextResponse.json(
      { error: 'Too Many Requests: Rate limit exceeded' },
      { status: 429, headers }
    );
  }

  // 3. Payload Validation
  let bodyJson: any;
  try {
    bodyJson = await req.json();
  } catch (err) {
    return NextResponse.json(
      { error: 'Bad Request: Invalid JSON body' },
      { status: 400, headers }
    );
  }

  const validation = ProxyRequestSchema.safeParse(bodyJson);
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Bad Request: Schema validation failed', details: validation.error.format() },
      { status: 400, headers }
    );
  }

  const { targetUrl, model, messages, temperature, max_tokens, stream } = validation.data;
  const promptText = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  // 4. Guardrails Inspection (Layer 1 & Layer 2)
  const guardrailResult = await executeGuardrails(promptText);
  if (!guardrailResult.isSafe) {
    const latency = Date.now() - startTime;
    
    // Log blocked event telemetry
    await logTelemetry({
      tenant_id: tenant.id,
      request_path: '/api/v1/proxy',
      request_method: 'POST',
      prompt: promptText,
      response: `Blocked by Guardrails: ${guardrailResult.threatType}`,
      tokens_prompt: estimateTokens(promptText),
      tokens_completion: 0,
      tokens_total: estimateTokens(promptText),
      cost_usd: 0,
      latency_ms: latency,
      status_code: 403,
      is_blocked: true,
      blocked_by: guardrailResult.blockedBy,
      threat_type: guardrailResult.threatType,
      confidence: guardrailResult.confidence,
    });

    return NextResponse.json(
      { 
        error: 'Forbidden: Threat detected in LLM payload', 
        blocked_by: guardrailResult.blockedBy,
        threat_type: guardrailResult.threatType,
        confidence: guardrailResult.confidence
      },
      { status: 403, headers }
    );
  }

  // 5. Proxy Forwarder & Cost Engine
  // Prepare downstream body (strip targetUrl)
  const downstreamBody = {
    model,
    messages,
    ...(temperature !== undefined && { temperature }),
    ...(max_tokens !== undefined && { max_tokens }),
    stream
  };

  // Re-map request headers to send to target LLM API
  const downstreamHeaders = new Headers();
  downstreamHeaders.set('Content-Type', 'application/json');
  
  // Forward authorization credentials
  const clientAuth = req.headers.get('Authorization');
  if (clientAuth) {
    downstreamHeaders.set('Authorization', clientAuth);
  }
  
  const clientApiKey = req.headers.get('api-key') || req.headers.get('x-api-key');
  if (clientApiKey) {
    downstreamHeaders.set('api-key', clientApiKey);
    downstreamHeaders.set('x-api-key', clientApiKey);
  }

  // Forward extra provider-specific headers (e.g. Anthropic)
  const anthropicVersion = req.headers.get('anthropic-version');
  if (anthropicVersion) {
    downstreamHeaders.set('anthropic-version', anthropicVersion);
  }

  const promptTokens = estimateTokens(promptText);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: downstreamHeaders,
      body: JSON.stringify(downstreamBody),
    });

    if (!response.ok) {
      const errorContent = await response.text();
      const latency = Date.now() - startTime;
      
      await logTelemetry({
        tenant_id: tenant.id,
        request_path: '/api/v1/proxy',
        request_method: 'POST',
        prompt: promptText,
        response: `Target API Error: ${errorContent.substring(0, 1000)}`,
        tokens_prompt: promptTokens,
        tokens_completion: 0,
        tokens_total: promptTokens,
        cost_usd: 0,
        latency_ms: latency,
        status_code: response.status,
        is_blocked: false,
      });

      return new Response(errorContent, {
        status: response.status,
        headers: headers
      });
    }

    // 5a) Handle Streaming Responses
    if (stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let accumulatedResponseText = '';

      // Return a ReadableStream to client immediately
      const customStream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              controller.enqueue(encoder.encode(chunk));

              // Parse chunk lines to accumulate content text (useful for SSE streams)
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const dataStr = line.slice(6).trim();
                  if (dataStr === '[DONE]') continue;
                  try {
                    const parsed = JSON.parse(dataStr);
                    const delta = parsed.choices?.[0]?.delta?.content || parsed.delta?.text || '';
                    accumulatedResponseText += delta;
                  } catch (e) {
                    // Ignore non-JSON lines or partial lines
                  }
                }
              }
            }
          } catch (err) {
            console.error('Error during streaming reading:', err);
            controller.error(err);
          } finally {
            controller.close();

            // Run final telemetry asynchronously
            const latency = Date.now() - startTime;
            const completionTokens = estimateTokens(accumulatedResponseText);
            const totalTokens = promptTokens + completionTokens;
            const costUsd = calculateCost(model, promptTokens, completionTokens);

            logTelemetry({
              tenant_id: tenant.id,
              request_path: '/api/v1/proxy',
              request_method: 'POST',
              prompt: promptText,
              response: accumulatedResponseText.substring(0, 1000),
              tokens_prompt: promptTokens,
              tokens_completion: completionTokens,
              tokens_total: totalTokens,
              cost_usd: costUsd,
              latency_ms: latency,
              status_code: 200,
              is_blocked: false,
            });
          }
        }
      });

      // Apply CORS and security headers to the stream response
      applySecurityHeaders(headers);
      headers.set('Content-Type', 'text/event-stream');
      headers.set('Cache-Control', 'no-cache');
      headers.set('Connection', 'keep-alive');

      return new Response(customStream, { headers });
    } 
    
    // 5b) Handle Non-Streaming JSON Responses
    else {
      const responseData = await response.json();
      const latency = Date.now() - startTime;

      // Extract tokens from provider usage structure if present
      let completionTokens = 0;
      let finalPromptTokens = promptTokens;
      
      if (responseData.usage) {
        if (responseData.usage.prompt_tokens) finalPromptTokens = responseData.usage.prompt_tokens;
        if (responseData.usage.completion_tokens) completionTokens = responseData.usage.completion_tokens;
      } else {
        // Fallback: estimate from text content
        const responseText = responseData.choices?.[0]?.message?.content || 
                             responseData.content?.[0]?.text || 
                             JSON.stringify(responseData);
        completionTokens = estimateTokens(responseText);
      }

      const totalTokens = finalPromptTokens + completionTokens;
      const costUsd = calculateCost(model, finalPromptTokens, completionTokens);

      const responseTextForLog = responseData.choices?.[0]?.message?.content || 
                                 responseData.content?.[0]?.text || 
                                 JSON.stringify(responseData);

      // Async telemetry write
      logTelemetry({
        tenant_id: tenant.id,
        request_path: '/api/v1/proxy',
        request_method: 'POST',
        prompt: promptText,
        response: responseTextForLog.substring(0, 1000),
        tokens_prompt: finalPromptTokens,
        tokens_completion: completionTokens,
        tokens_total: totalTokens,
        cost_usd: costUsd,
        latency_ms: latency,
        status_code: 200,
        is_blocked: false,
      });

      // Forward response to client with security headers
      applySecurityHeaders(headers);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers
      });
    }

  } catch (fetchErr: any) {
    const latency = Date.now() - startTime;
    console.error('Proxy proxying error:', fetchErr);
    
    await logTelemetry({
      tenant_id: tenant.id,
      request_path: '/api/v1/proxy',
      request_method: 'POST',
      prompt: promptText,
      response: `Failed to connect to target: ${fetchErr.message}`,
      tokens_prompt: promptTokens,
      tokens_completion: 0,
      tokens_total: promptTokens,
      cost_usd: 0,
      latency_ms: latency,
      status_code: 502,
      is_blocked: false,
    });

    return NextResponse.json(
      { error: 'Bad Gateway: Could not forward request to target LLM provider' },
      { status: 502, headers }
    );
  }
}
