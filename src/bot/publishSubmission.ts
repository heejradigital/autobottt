import { Bot } from "grammy";
import {
  getSubmissionById,
  updateSubmissionStatus,
  type Submission,
} from "../database/submissions";
import { publishToTelegram } from "../publishers/telegram";
import { publishToWhatsApp } from "../publishers/whatsapp";
import { notifyWhatsAppSubmitter } from "./whatsappInput";

export function captionOf(submission: Submission): string {
  return submission.final_caption ?? submission.generated_caption ?? "";
}

export type PublishOutcome = {
  submission: Submission;
  telegramStatus: string;
  whatsappStatus: string;
  telegramError?: string;
  whatsappError?: string;
  fullyPublished: boolean;
};

export async function publishApprovedSubmission(
  bot: Bot,
  submissionId: number,
): Promise<PublishOutcome> {
  let submission = getSubmissionById(submissionId);
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found`);
  }

  if (submission.status !== "ADMIN_REVIEW" && submission.status !== "APPROVED") {
    throw new Error(`Submission #${submissionId} bukan dalam ADMIN_REVIEW (status: ${submission.status})`);
  }

  const finalCaption = captionOf(submission);
  submission = updateSubmissionStatus(submissionId, "APPROVED", {
    final_caption: finalCaption,
    approved_at: new Date().toISOString(),
  });

  let telegramStatus = submission.telegram_publish_status;
  let telegramMessageId = submission.telegram_message_id;
  let telegramError: string | undefined;

  if (telegramStatus !== "published") {
    const tg = await publishToTelegram(bot, submission.poster_file_path, finalCaption);
    if (tg.ok) {
      telegramStatus = "published";
      telegramMessageId = tg.messageId ?? null;
    } else {
      telegramStatus = "failed";
      telegramError = tg.error;
    }
  }

  let whatsappStatus = submission.whatsapp_publish_status;
  let whatsappError: string | undefined;

  if (telegramStatus === "published") {
    const wa = await publishToWhatsApp(submission.poster_file_path, finalCaption);
    if (wa.skipped) {
      whatsappStatus = "skipped";
    } else if (wa.ok) {
      whatsappStatus = "published";
    } else {
      whatsappStatus = "failed";
      whatsappError = wa.error;
    }
  } else {
    whatsappStatus = "pending";
  }

  const fullyPublished =
    telegramStatus === "published" &&
    (whatsappStatus === "published" || whatsappStatus === "skipped");

  submission = updateSubmissionStatus(submissionId, fullyPublished ? "PUBLISHED" : "APPROVED", {
    telegram_publish_status: telegramStatus,
    whatsapp_publish_status: whatsappStatus,
    telegram_message_id: telegramMessageId,
    published_at: fullyPublished ? new Date().toISOString() : null,
    error_message:
      [telegramError, whatsappError].filter(Boolean).join(" | ") || null,
  });

  if (fullyPublished && submission.source === "whatsapp" && submission.whatsapp_sender) {
    await notifyWhatsAppSubmitter(
      submission.whatsapp_sender,
      "✅ Poster anda telah diluluskan dan diterbitkan ke Telegram @infomaulid dan WhatsApp Channel Info Maulid.",
    );
  }

  return {
    submission,
    telegramStatus,
    whatsappStatus,
    telegramError,
    whatsappError,
    fullyPublished,
  };
}

export function formatPublishResult(outcome: PublishOutcome, submissionId: number): string {
  return [
    `📣 Hasil publish #${submissionId}`,
    `Telegram: ${labelPublish(outcome.telegramStatus)}${outcome.telegramError ? ` (${outcome.telegramError})` : ""}`,
    `WhatsApp: ${labelPublish(outcome.whatsappStatus)}${outcome.whatsappError ? ` (${outcome.whatsappError})` : ""}`,
    `Status: ${outcome.submission.status}`,
  ].join("\n");
}

function labelPublish(status: string): string {
  switch (status) {
    case "published":
      return "Published";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}
