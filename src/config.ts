import dotenv from "dotenv";
import path from "path";

dotenv.config();

// Railway persistent storage support
const persistentStorage = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.PERSISTENT_STORAGE || "";


function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() ?? fallback;
}

function parseAdminIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const id = Number(part);
      if (!Number.isFinite(id)) {
        throw new Error(`Invalid ADMIN_TELEGRAM_IDS entry: ${part}`);
      }
      return id;
    });
}

function parseWhatsAppNumbers(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().replace(/[^\d]/g, ""))
    .filter(Boolean);
}

const whatsappTargetNumbers = parseWhatsAppNumbers(optional("WHATSAPP_TARGET_NUMBER"));
const whatsappInputNumbers = parseWhatsAppNumbers(optional("WHATSAPP_INPUT_NUMBERS"));
const whatsappAdminNumbers = parseWhatsAppNumbers(optional("WHATSAPP_ADMIN_NUMBERS"));
const whatsappAdminReviewNumber = parseWhatsAppNumbers(optional("WHATSAPP_ADMIN_REVIEW_NUMBER"))[0] ?? "";

function parseBool(raw: string, fallback = false): boolean {
  const value = raw?.trim().toLowerCase() || "";
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function parseChannelInvite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const fromUrl = trimmed.match(/whatsapp\.com\/channel\/([^/?#]+)/i);
  return (fromUrl?.[1] ?? trimmed).trim();
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  adminTelegramIds: parseAdminIds(required("ADMIN_TELEGRAM_IDS")),
  telegramTargetChatId: required("TELEGRAM_TARGET_CHAT_ID"),
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiVisionModel: optional("GEMINI_VISION_MODEL", "gemini-flash-lite-latest"),
  geminiCopyModel: optional("GEMINI_COPY_MODEL", "gemini-flash-lite-latest"),
  whatsappEnabled: optional("WHATSAPP_ENABLED", "false").toLowerCase() === "true",
  whatsappProvider: optional("WHATSAPP_PROVIDER", "baileys").toLowerCase(),
  /** Raw env value (may contain comma-separated numbers). */
  whatsappTargetNumber: optional("WHATSAPP_TARGET_NUMBER"),
  /** Normalized destination numbers. Supports multiple, comma-separated. */
  whatsappTargetNumbers,
  whatsappChannelEnabled: optional("WHATSAPP_CHANNEL_ENABLED", "false").toLowerCase() === "true",
  whatsappChannelInvite: parseChannelInvite(optional("WHATSAPP_CHANNEL_INVITE")),
  /** Accept poster submissions via WhatsApp (Option A). */
  whatsappInputEnabled: parseBool(optional("WHATSAPP_INPUT_ENABLED", "false")),
  /** When true, anyone can submit posters (ignore WHATSAPP_INPUT_NUMBERS). */
  whatsappInputOpen: parseBool(optional("WHATSAPP_INPUT_OPEN", "true")),
  /** Phone numbers allowed to submit posters when WHATSAPP_INPUT_OPEN=false. */
  whatsappInputNumbers,
  /** Admin review + approve via WhatsApp (no Telegram bot review). */
  whatsappReviewEnabled: parseBool(optional("WHATSAPP_REVIEW_VIA_WHATSAPP", "true")),
  /** Where admin review previews are sent (usually linked Info Maulid number). */
  whatsappAdminReviewNumber,
  /** Phone numbers allowed to LULUS/TOLAK/EDIT submissions. */
  whatsappAdminNumbers,
  /** When false, skip Telegram long-polling (publish API still used). */
  telegramBotPollingEnabled: parseBool(optional("TELEGRAM_BOT_POLLING", "false")),
  /** When false, ignore photo submissions on Telegram (admin commands still work). */
  telegramInputEnabled: parseBool(optional("TELEGRAM_INPUT_ENABLED", "false")),
  /** When false, skip sending to personal WhatsApp numbers on publish (channel only). */
  whatsappPersonalPublishEnabled: parseBool(optional("WHATSAPP_PERSONAL_PUBLISH", "true")),
  whatsappAccessToken: optional("WHATSAPP_ACCESS_TOKEN"),
  whatsappPhoneNumberId: optional("WHATSAPP_PHONE_NUMBER_ID"),
  dbPath: optional("DB_PATH", persistentStorage ? path.join(persistentStorage, "data", "infomaulid.db") : path.join(process.cwd(), "data", "infomaulid.db")),
  downloadsDir: persistentStorage ? path.join(persistentStorage, "downloads") : path.join(process.cwd(), "downloads"),
};

export function isAdmin(userId: number | undefined): boolean {
  if (userId === undefined) return false;
  return config.adminTelegramIds.includes(userId);
}

export function isWhatsAppInputAllowed(phoneDigits: string): boolean {
  if (!config.whatsappInputEnabled) return false;
  if (config.whatsappInputOpen) return true;
  if (config.whatsappInputNumbers.length === 0) return true;
  const normalized = phoneDigits.replace(/[^\d]/g, "");
  return config.whatsappInputNumbers.some((allowed) => {
    const a = allowed.replace(/[^\d]/g, "");
    return normalized === a || normalized.endsWith(a) || a.endsWith(normalized);
  });
}

export function isWhatsAppAdmin(phoneDigits: string): boolean {
  const normalized = phoneDigits.replace(/[^\d]/g, "");
  const admins =
    config.whatsappAdminNumbers.length > 0
      ? config.whatsappAdminNumbers
      : config.whatsappInputNumbers;
  return admins.some((allowed) => {
    const a = allowed.replace(/[^\d]/g, "");
    return normalized === a || normalized.endsWith(a) || a.endsWith(normalized);
  });
}

/** All admins that receive review previews, approve buttons, and QR codes. */
export function getWhatsAppAdminReviewRecipients(): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const phone of [
    ...config.whatsappAdminNumbers,
    ...(config.whatsappAdminReviewNumber ? [config.whatsappAdminReviewNumber] : []),
  ]) {
    const normalized = phone.replace(/[^\d]/g, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    recipients.push(normalized);
  }

  return recipients;
}

export function assertWhatsAppConfig(): void {
  if (!config.whatsappEnabled) return;

  const needsPublishTarget =
    config.whatsappPersonalPublishEnabled || config.whatsappChannelEnabled;
  if (config.whatsappTargetNumbers.length === 0 && !needsPublishTarget) {
    throw new Error(
      "Set WHATSAPP_TARGET_NUMBER and/or WHATSAPP_CHANNEL_ENABLED=true when WhatsApp is enabled",
    );
  }

  if (config.whatsappInputEnabled) {
    if (config.whatsappProvider !== "baileys") {
      throw new Error("WHATSAPP_INPUT_ENABLED requires WHATSAPP_PROVIDER=baileys");
    }
    if (
      !config.whatsappInputOpen &&
      config.whatsappInputNumbers.length === 0
    ) {
      throw new Error(
        "Set WHATSAPP_INPUT_OPEN=true or WHATSAPP_INPUT_NUMBERS when WHATSAPP_INPUT_ENABLED=true",
      );
    }
    if (config.whatsappReviewEnabled && !config.whatsappAdminReviewNumber) {
      throw new Error(
        "WHATSAPP_ADMIN_REVIEW_NUMBER is required when WHATSAPP_REVIEW_VIA_WHATSAPP=true",
      );
    }
  }

  if (config.whatsappChannelEnabled && !config.whatsappChannelInvite) {
    throw new Error("WHATSAPP_CHANNEL_INVITE is required when WHATSAPP_CHANNEL_ENABLED=true");
  }

  if (config.whatsappProvider === "baileys") {
    return;
  }

  if (config.whatsappProvider === "meta") {
    if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
      throw new Error(
        "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_PROVIDER=meta",
      );
    }
    return;
  }

  throw new Error(
    `Unsupported WHATSAPP_PROVIDER: ${config.whatsappProvider}. Supported: baileys, meta`,
  );
}
