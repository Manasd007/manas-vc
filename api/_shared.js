export function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded && forwarded.split(",")[0].trim()) || request.headers.get("x-real-ip") || "unknown";
}

export function rateLimiter(limit, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return (request) => {
    const ip = clientIp(request);
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > limit;
  };
}

export const isHindi = (text) => /[\u0900-\u097F]/.test(String(text || ""));

export const BUSY = "Lots of questions in a short time. Give it a few minutes and try again.";
export const BROKEN = "Something went wrong. Try again.";
export const SLOW = "That took too long. Try again.";
