import fs from "fs";
import path from "path";
import { Bot } from "grammy";
import { config } from "../config";
import { createSubmission } from "../database/submissions";
import type { WhatsAppIncomingMessage } from "../publishers/whatsappClient";
import { sendWhatsAppText } from "../publishers/whatsappClient";
import { ensureDownloadsDir } from "../utils/download";
import { logger } from "../utils/logger";
import { processSubmissionPipeline } from "./processSubmission";
import { shouldSendReply } from "./rateLimiter";

export const POSTER_RECEIVED_REPLY = [
  "📥 Terima kasih. Poster anda akan disemak oleh admin InfoMaulid sebelum diterbitkan di Channel Telegram @infomaulid dan Channel WhatsApp InfoMaulid.",
  "",
  "Sila pastikan:",
  "",
  "1. Penceramah mempunyai tauliah agama negeri.",
  "2. Tiada isu kontroversi & mempunyai sanad pengajian yang jelas.",
  "3. Nyatakan tarikh, hari & masa program.",
  "4. Sertakan lokasi lengkap program.",
  "",
  "🔗 WhatsApp Channel Info Maulid: https://whatsapp.com/channel/0029Va4ANcRFi8xZJlLJN93E",
  "",
  "Terima kasih atas kerjasama.",
].join("\n");

function saveWhatsAppPoster(message: WhatsAppIncomingMessage): string {
  ensureDownloadsDir();
  const ext = message.mimeType.includes("png")
    ? "png"
    : message.mimeType.includes("webp")
      ? "webp"
      : message.mimeType.includes("gif")
        ? "gif"
        : "jpg";
  const fileName = `wa_${Date.now()}_${message.fromPhone}.${ext}`;
  const localPath = path.join(config.downloadsDir, fileName);
  fs.writeFileSync(localPath, message.imageBuffer);
  logger.info(`Saved WhatsApp poster to ${localPath}`);
  return localPath;
}

export async function handleWhatsAppPosterInput(
  bot: Bot,
  message: WhatsAppIncomingMessage,
): Promise<void> {
  try {
    const localPath = saveWhatsAppPoster(message);
    const submission = createSubmission({
      posterFilePath: localPath,
      posterFileId: `wa:${message.messageId}`,
      userText: message.caption,
      source: "whatsapp",
      whatsappSender: message.fromPhone,
      telegramFullName: `WhatsApp ${message.fromPhone}`,
    });

    logger.info(`Created submission #${submission.id} from WhatsApp ${message.fromPhone}`);

    // Only send auto-reply if within rate limit
    if (shouldSendReply(message.fromPhone)) {
      await sendWhatsAppText(message.fromPhone, POSTER_RECEIVED_REPLY);
      logger.info(`Auto-reply sent to ${message.fromPhone}`);
    } else {
      logger.info(`Auto-reply skipped for ${message.fromPhone} (rate limited)`);
    }

    // Process the pipeline in background but log errors
    processSubmissionPipeline(bot, submission.id).catch((error) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Pipeline failed for submission #${submission.id}`, errMsg);
      // Notify user of failure if it hasn't been approved yet
      void notifyWhatsAppSubmitter(
        message.fromPhone,
        `Maaf, pemprosesan poster anda gagal: ${errMsg}. Sila cuba hantar semula.`,
      );
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to accept WhatsApp poster", errMsg);
    await sendWhatsAppText(
      message.fromPhone,
      `Maaf, gagal memproses poster: ${errMsg}. Sila cuba hantar semula.`,
    );
  }
}

export async function notifyWhatsAppSubmitter(
  phone: string,
  text: string,
): Promise<void> {
  const result = await sendWhatsAppText(phone, text);
  if (!result.ok) {
    logger.warn(`Failed to notify WhatsApp submitter ${phone}: ${result.error}`);
  }
}
