import { Bot, InputFile } from "grammy";
import { generateInfoMaulidCaption } from "../ai/copywriting";
import { extractEventInfoFromPoster, isIslamicEventPoster } from "../ai/extract";
import { config } from "../config";
import {
  getSubmissionById,
  parseExtractedInfo,
  updateSubmissionStatus,
  type Submission,
} from "../database/submissions";
import { logger } from "../utils/logger";
import { formatAdminPreview, truncateForCaption } from "./format";
import { reviewKeyboard } from "./keyboards";
import { notifyWhatsAppSubmitter, POSTER_RECEIVED_REPLY } from "./whatsappInput";
import { sendWhatsAppAdminReview } from "./whatsappReview";
import { sendWhatsAppText } from "../publishers/whatsappClient";

async function notifySubmitter(bot: Bot, submission: Submission, text: string): Promise<void> {
  if (submission.source === "whatsapp" && submission.whatsapp_sender) {
    await notifyWhatsAppSubmitter(submission.whatsapp_sender, text);
    return;
  }

  if (submission.telegram_user_id) {
    try {
      await bot.api.sendMessage(submission.telegram_user_id, text);
    } catch {
      // User may have blocked the bot; ignore.
    }
  }
}

async function notifyAdminsForReview(bot: Bot, submission: Submission, caption: string): Promise<void> {
  if (config.whatsappReviewEnabled && submission.source === "whatsapp") {
    await sendWhatsAppAdminReview(submission, caption);
    return;
  }

  const preview = truncateForCaption(formatAdminPreview(submission, caption), 900);

  for (const adminId of config.adminTelegramIds) {
    try {
      await bot.api.sendPhoto(adminId, new InputFile(submission.poster_file_path), {
        caption: preview,
        reply_markup: reviewKeyboard(submission.id),
      });
    } catch (error) {
      logger.error(`Failed to notify admin ${adminId}`, error);
    }
  }
}

export async function processSubmissionPipeline(bot: Bot, submissionId: number): Promise<void> {
  let submission = getSubmissionById(submissionId);
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found`);
  }

  submission = updateSubmissionStatus(submissionId, "AI_PROCESSING");

  try {
    const extracted = await extractEventInfoFromPoster(
      submission.poster_file_path,
      submission.user_text,
    );

    if (!isIslamicEventPoster(extracted)) {
      logger.info(`Submission #${submissionId} skipped — not an Islamic event poster`, {
        reason: extracted.classificationReason,
      });

      updateSubmissionStatus(submissionId, "REJECTED", {
        extracted_info: JSON.stringify(extracted),
        error_message: extracted.classificationReason ?? "Not an Islamic event poster",
      });
      return;
    }

    await notifySubmitter(bot, submission, POSTER_RECEIVED_REPLY);

    const caption = await generateInfoMaulidCaption(extracted, submission.user_text);

    submission = updateSubmissionStatus(submissionId, "ADMIN_REVIEW", {
      extracted_info: JSON.stringify(extracted),
      generated_caption: caption,
      final_caption: caption,
      error_message: null,
    });

    await notifyAdminsForReview(bot, submission, caption);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`AI processing failed for #${submissionId}`, message);
    updateSubmissionStatus(submissionId, "SUBMITTED", {
      error_message: message,
    });

    if (!config.whatsappReviewEnabled) {
      for (const adminId of config.adminTelegramIds) {
        await bot.api.sendMessage(
          adminId,
          `⚠️ AI processing failed for submission #${submissionId}:\n${message}`,
        );
      }
    } else if (config.whatsappAdminReviewNumber) {
      await sendWhatsAppText(
        config.whatsappAdminReviewNumber,
        `⚠️ AI gagal untuk submission #${submissionId}:\n${message}`,
      );
    }

    await notifySubmitter(
      bot,
      submission,
      "Maaf, pemprosesan poster gagal. Sila cuba hantar semula atau hubungi admin.",
    );
  }
}

export async function regenerateCaption(
  bot: Bot,
  submissionId: number,
  options: { notifyViaWhatsApp?: boolean } = {},
): Promise<Submission> {
  const submission = getSubmissionById(submissionId);
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found`);
  }

  const extracted = parseExtractedInfo(submission.extracted_info);
  if (!extracted) {
    throw new Error("No extracted info available to regenerate caption");
  }

  updateSubmissionStatus(submissionId, "AI_PROCESSING");

  const caption = await generateInfoMaulidCaption(extracted, submission.user_text);
  const updated = updateSubmissionStatus(submissionId, "ADMIN_REVIEW", {
    generated_caption: caption,
    final_caption: caption,
    error_message: null,
  });

  if (options.notifyViaWhatsApp || (config.whatsappReviewEnabled && updated.source === "whatsapp")) {
    await sendWhatsAppAdminReview(updated, caption);
  } else {
    await notifyAdminsForReview(bot, updated, caption);
  }

  return updated;
}
