import { Bot, InputFile } from "grammy";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface TelegramPublishResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Convert WhatsApp-style *bold* markers into Telegram HTML <b>bold</b>.
 * Keeps the same caption source usable for both Telegram and WhatsApp.
 */
export function captionForTelegramHtml(caption: string): string {
  const escaped = caption
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
}

/**
 * Publish original poster + caption to the configured Telegram channel/group.
 * Independent from WhatsApp publishing.
 */
export async function publishToTelegram(
  bot: Bot,
  posterFilePath: string,
  caption: string,
): Promise<TelegramPublishResult> {
  try {
    const message = await bot.api.sendPhoto(config.telegramTargetChatId, new InputFile(posterFilePath), {
      caption: captionForTelegramHtml(caption),
      parse_mode: "HTML",
    });

    logger.info(`Published to Telegram chat ${config.telegramTargetChatId}`, {
      messageId: message.message_id,
    });

    return {
      ok: true,
      messageId: String(message.message_id),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Telegram publish failed", message);
    return { ok: false, error: message };
  }
}
