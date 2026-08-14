// Right now function logs only exist for the error paths (errors.ts,
// rate-limit.ts) — a successful request leaves no trace at all, so there's no
// way to see traffic/latency in the Supabase dashboard. Wrapping every return
// point with this gives one structured log line per request (status + method
// + latency) without changing what gets returned to the caller.
export function requestLogger(endpoint: string, method: string) {
  const startedAt = Date.now();
  return function log(response: Response): Response {
    console.log(
      JSON.stringify({
        endpoint,
        method,
        status: response.status,
        ms: Date.now() - startedAt,
      }),
    );
    return response;
  };
}
