/**
 * Rate limiter for WhatsApp auto-replies.
 * Prevents spamming users with multiple replies when they send multiple posters.
 */

const replyTimestamps = new Map<string, number>();
const RATE_LIMIT_MS = 3 * 60 * 1000; // 3 minutes

export function shouldSendReply(phone: string): boolean {
  const normalized = phone.replace(/[^\d]/g, "");
  const lastReply = replyTimestamps.get(normalized);
  const now = Date.now();

  if (lastReply && now - lastReply < RATE_LIMIT_MS) {
    // Within rate limit window, don't send reply
    return false;
  }

  // Update timestamp and allow reply
  replyTimestamps.set(normalized, now);
  
  // Clean up old entries periodically
  if (replyTimestamps.size > 1000) {
    const cutoff = now - RATE_LIMIT_MS;
    for (const [key, timestamp] of replyTimestamps.entries()) {
      if (timestamp < cutoff) {
        replyTimestamps.delete(key);
      }
    }
  }

  return true;
}

export function resetRateLimit(phone: string): void {
  const normalized = phone.replace(/[^\d]/g, "");
  replyTimestamps.delete(normalized);
}
