export interface RateLimitResult {
  data: boolean | null;
  error: { message: string } | null;
}

export interface RateLimitDecision {
  status: number;
  body: { error: string };
}

export function evaluateRateLimit(result: RateLimitResult): RateLimitDecision | null {
  if (result.error) {
    console.error(result.error.message);
    return { status: 500, body: { error: "internal server error" } };
  }
  if (result.data === false) {
    return { status: 429, body: { error: "rate limit exceeded, try again later" } };
  }
  return null;
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RateLimitResult>;
}

export async function enforceRateLimit(
  supabase: RpcClient,
  endpoint: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<Response | null> {
  const result = await supabase.rpc("check_rate_limit", {
    p_endpoint: endpoint,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  });

  const decision = evaluateRateLimit(result);
  return decision ? Response.json(decision.body, { status: decision.status }) : null;
}
