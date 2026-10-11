# Changelog

## [Unreleased]

### Fixed
- **Rate limiting for WhatsApp auto-replies**: Now only sends auto-reply once per 3 minutes per phone number, preventing spam when users send multiple posters
- **Strict whitelist enforcement**: Non-whitelisted numbers (not admin, not in allowed list) no longer receive any auto-reply when sending posters/videos/photos

### Changed
- Modified `src/bot/whatsappInput.ts` to use rate limiter before sending auto-reply
- Modified `src/publishers/whatsappClient.ts` to remove auto-reply for non-whitelisted senders
- Added `src/bot/rateLimiter.ts` for managing reply rate limits

### Technical Details
- Rate limit window: 3 minutes (180,000ms)
- Rate limiter automatically cleans up old entries to prevent memory leaks
- Non-whitelisted senders are silently ignored with log entry only
