import { Bot, InputFile } from "grammy";
import { createBot, startBot } from "./bot";
import { assertWhatsAppConfig, config, getWhatsAppAdminReviewRecipients } from "./config";
import { closeDb, getDb } from "./database/db";
import {
  setWhatsAppMessageHandler,
  setWhatsAppButtonHandler,
  setWhatsAppQrHandler,
  setWhatsAppTextHandler,
  sendWhatsAppImage,
  startWhatsAppClient,
  stopWhatsAppClient,
} from "./publishers/whatsappClient";
import { handleWhatsAppPosterInput } from "./bot/whatsappInput";
import {
  handleWhatsAppAdminText,
  handleWhatsAppButtonReply,
  isAdminWhatsAppSender,
  isWhatsAppAdminCommand,
} from "./bot/whatsappReview";
import { ensureDownloadsDir } from "./utils/download";
import { logger } from "./utils/logger";

/** Baileys emits QR repeatedly; avoid spamming admin chats. */
let lastTelegramQrSentAt = 0;
const TELEGRAM_QR_COOLDOWN_MS = 45_000;

async function sendQrToAdminTelegram(bot: Bot, png: Buffer): Promise<void> {
  const now = Date.now();
  if (now - lastTelegramQrSentAt < TELEGRAM_QR_COOLDOWN_MS) {
    return;
  }
  lastTelegramQrSentAt = now;

  const caption = [
    "📱 *Info Maulid — scan QR WhatsApp (Baileys)*",
    "",
    "WhatsApp → Settings → Linked Devices → Link a Device",
    "",
    "Guna nombor WhatsApp Info Maulid yang admin channel.",
  ].join("\n");

  for (const adminId of config.adminTelegramIds) {
    try {
      await bot.api.sendPhoto(adminId, new InputFile(png, "whatsapp-qr.png"), {
        caption,
        parse_mode: "Markdown",
      });
      logger.info("WhatsApp QR sent to Telegram admin", { adminId });
    } catch (error) {
      logger.error(
        `Failed to send WhatsApp QR to Telegram admin ${adminId}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function sendQrToAdminWhatsApp(png: Buffer): Promise<void> {
  const targets = getWhatsAppAdminReviewRecipients();
  if (targets.length === 0) return;

  const fs = await import("fs");
  const tmpPath = `${process.cwd()}/downloads/whatsapp-qr-${Date.now()}.png`;
  fs.writeFileSync(tmpPath, png);
  const caption = [
    "📱 Scan QR ni dengan WhatsApp Info Maulid:",
    "WhatsApp → Settings → Linked Devices → Link a Device",
  ].join("\n");

  for (const target of targets) {
    const result = await sendWhatsAppImage(target, tmpPath, caption);
    if (!result.ok) {
      logger.error(`Failed to send WhatsApp QR to ${target}`, result.error);
    }
  }

  try {
    fs.unlinkSync(tmpPath);
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  ensureDownloadsDir();
  getDb();
  assertWhatsAppConfig();

  logger.info("InfoMaulid Bot boot", {
    targetChat: config.telegramTargetChatId,
    whatsappInputEnabled: config.whatsappInputEnabled,
    whatsappInputOpen: config.whatsappInputOpen,
    whatsappReviewEnabled: config.whatsappReviewEnabled,
    whatsappAdminReviewNumber: config.whatsappAdminReviewNumber,
    whatsappAdminNumbers: config.whatsappAdminNumbers,
    telegramBotPollingEnabled: config.telegramBotPollingEnabled,
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || "development",
  });

  const bot = createBot();

  if (config.whatsappEnabled && config.whatsappProvider === "baileys") {
    setWhatsAppQrHandler(async (png) => {
      await sendQrToAdminTelegram(bot, png);
      if (config.whatsappReviewEnabled && config.whatsappAdminReviewNumber) {
        await sendQrToAdminWhatsApp(png);
      }
    });

    if (config.whatsappInputEnabled) {
      setWhatsAppMessageHandler(async (message) => {
        await handleWhatsAppPosterInput(bot, message);
      });
    }

    if (config.whatsappReviewEnabled) {
      setWhatsAppButtonHandler(async (payload) => {
        await handleWhatsAppButtonReply(bot, payload.fromPhone, payload.buttonId);
      });

      setWhatsAppTextHandler(async (message) => {
        if (!isAdminWhatsAppSender(message.fromPhone) && !isWhatsAppAdminCommand(message.text)) {
          return;
        }
        await handleWhatsAppAdminText(bot, message.fromPhone, message.text);
      });
    }

    void startWhatsAppClient().catch((error) => {
      logger.error("WhatsApp client failed to start", error);
    });
  }

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down…`);
    if (config.telegramBotPollingEnabled) {
      bot.stop();
    }
    await stopWhatsAppClient();
    closeDb();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (config.telegramBotPollingEnabled) {
    await startBot(bot);
  } else {
    logger.info("Telegram bot polling disabled — publish API only (WhatsApp review mode)");
    // Keep process alive for WhatsApp client
    // Railway needs the process to stay running
    await new Promise<void>((resolve) => {
      // Never resolve - keep running until shutdown signal
    });
  }
}

main().catch((error) => {
  logger.error("Fatal startup error", error instanceof Error ? error.message : error);
  process.exit(1);
});
