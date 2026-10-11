import { Bot } from "grammy";
import { getWhatsAppAdminReviewRecipients, isWhatsAppAdmin } from "../config";
import {
  getSubmissionById,
  updateSubmissionStatus,
  type Submission,
} from "../database/submissions";
import {
  sendWhatsAppImage,
  sendWhatsAppInteractiveButtons,
  sendWhatsAppText,
} from "../publishers/whatsappClient";
import { logger } from "../utils/logger";
import { truncateForCaption } from "./format";
import {
  captionOf,
  formatPublishResult,
  publishApprovedSubmission,
} from "./publishSubmission";
import { regenerateCaption } from "./processSubmission";
import { notifyWhatsAppSubmitter } from "./whatsappInput";

const editState = new Map<string, number>();

function formatReviewCaption(submission: Submission, copywriting: string): string {
  const fromLine = submission.whatsapp_sender
    ? `Dari: ${submission.whatsapp_sender}`
    : "Dari: (unknown)";

  return truncateForCaption(
    [`#${submission.id} | ${fromLine}`, "", copywriting].join("\n"),
    1000,
  );
}

export async function sendWhatsAppAdminReview(
  submission: Submission,
  caption: string,
): Promise<void> {
  const targets = getWhatsAppAdminReviewRecipients();
  if (targets.length === 0) {
    logger.error("No WHATSAPP_ADMIN_NUMBERS configured for review");
    return;
  }

  const reviewCaption = formatReviewCaption(submission, caption);

  for (const target of targets) {
    const imageResult = await sendWhatsAppImage(target, submission.poster_file_path, reviewCaption);

    if (!imageResult.ok) {
      logger.error(`Failed to send WA admin review image to ${target}`, imageResult.error);
      await sendWhatsAppText(target, `⚠️ Preview #${submission.id}\n\n${reviewCaption}`);
    }

    const buttonsResult = await sendWhatsAppInteractiveButtons(target, {
      body: `Semakan submission #${submission.id}`,
      footer: "InfoMaulid Admin",
      buttons: [
        { id: `approve_${submission.id}`, text: "✅ Approve" },
        { id: `reject_${submission.id}`, text: "❌ Reject" },
        { id: `edit_${submission.id}`, text: "✏️ Edit" },
      ],
    });

    if (!buttonsResult.ok) {
      logger.warn(`Review buttons fallback for ${target}`, buttonsResult.error);
    }
  }
}

export async function handleWhatsAppButtonReply(
  bot: Bot,
  fromPhone: string,
  buttonId: string,
): Promise<void> {
  if (!isWhatsAppAdmin(fromPhone)) return;

  const match = buttonId.match(/^(approve|reject|edit)_(\d+)$/i);
  if (!match) return;

  const action = match[1]!.toLowerCase();
  const id = Number(match[2]);

  switch (action) {
    case "approve":
      await handleApprove(bot, fromPhone, id);
      break;
    case "reject": {
      const submission = getSubmissionById(id);
      if (submission) await handleReject(fromPhone, id, submission);
      break;
    }
    case "edit": {
      const submission = getSubmissionById(id);
      if (!submission) {
        await sendWhatsAppText(fromPhone, `Submission #${id} tidak dijumpai.`);
        return;
      }
      editState.set(fromPhone, id);
      await sendWhatsAppText(
        fromPhone,
        `✏️ EDIT #${id}. Hantar caption baharu sebagai mesej seterusnya.\n\nCaption semasa:\n${captionOf(submission) || "(kosong)"}`,
      );
      break;
    }
  }
}

export async function handleWhatsAppAdminText(bot: Bot, fromPhone: string, text: string): Promise<void> {
  if (!isWhatsAppAdmin(fromPhone) && !shouldHandleAsAdminEdit(fromPhone)) {
    return;
  }

  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  const pendingEditId = editState.get(fromPhone);
  if (pendingEditId !== undefined) {
    editState.delete(fromPhone);
    await applyCaptionEdit(fromPhone, pendingEditId, trimmed);
    return;
  }

  const buttonStyle = upper.match(/^(APPROVE|REJECT|EDIT)_(\d+)$/);
  if (buttonStyle) {
    await handleWhatsAppButtonReply(bot, fromPhone, `${buttonStyle[1]!.toLowerCase()}_${buttonStyle[2]}`);
    return;
  }

  const match = upper.match(/^(LULUS|APPROVE|OK|TOLAK|REJECT|JANA|REGENERATE|EDIT|STATUS)\s+#?(\d+)$/);
  if (!match) {
    if (upper === "BANTUAN" || upper === "HELP") {
      await sendWhatsAppText(
        fromPhone,
        [
          "InfoMaulid — arahan admin:",
          "Tekan butang ✅ Approve / ❌ Reject / ✏️ Edit",
          "Atau taip: LULUS <id> | TOLAK <id> | EDIT <id>",
        ].join("\n"),
      );
    }
    return;
  }

  const [, command, idRaw] = match;
  const id = Number(idRaw);
  const submission = getSubmissionById(id);
  if (!submission) {
    await sendWhatsAppText(fromPhone, `Submission #${id} tidak dijumpai.`);
    return;
  }

  switch (command) {
    case "LULUS":
    case "APPROVE":
    case "OK":
      await handleApprove(bot, fromPhone, id);
      break;
    case "TOLAK":
    case "REJECT":
      await handleReject(fromPhone, id, submission);
      break;
    case "JANA":
    case "REGENERATE":
      await handleRegenerate(bot, fromPhone, id);
      break;
    case "EDIT":
      editState.set(fromPhone, id);
      await sendWhatsAppText(
        fromPhone,
        `✏️ EDIT #${id}. Hantar caption baharu sebagai mesej seterusnya.\n\nCaption semasa:\n${captionOf(submission) || "(kosong)"}`,
      );
      break;
    case "STATUS":
      await sendWhatsAppText(
        fromPhone,
        [
          `Submission #${submission.id}`,
          `Status: ${submission.status}`,
          `Telegram: ${submission.telegram_publish_status}`,
          `WhatsApp: ${submission.whatsapp_publish_status}`,
        ].join("\n"),
      );
      break;
  }
}

async function handleApprove(bot: Bot, adminPhone: string, id: number): Promise<void> {
  await sendWhatsAppText(adminPhone, `⏳ Meluluskan & publish #${id}…`);

  try {
    const outcome = await publishApprovedSubmission(bot, id);
    let reply = formatPublishResult(outcome, id);

    if (outcome.telegramStatus === "published" && outcome.whatsappStatus === "failed") {
      reply += `\n\nWhatsApp gagal. Tekan Approve semula atau taip LULUS ${id}.`;
    }

    await sendWhatsAppText(adminPhone, reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendWhatsAppText(adminPhone, `Publish gagal: ${message}`);
  }
}

async function handleReject(
  adminPhone: string,
  id: number,
  submission: Submission,
): Promise<void> {
  if (submission.status === "PUBLISHED") {
    await sendWhatsAppText(adminPhone, `#${id} sudah published.`);
    return;
  }

  updateSubmissionStatus(id, "REJECTED");
  await sendWhatsAppText(adminPhone, `❌ Submission #${id} ditolak.`);

  if (submission.source === "whatsapp" && submission.whatsapp_sender) {
    await notifyWhatsAppSubmitter(
      submission.whatsapp_sender,
      "Maaf, poster anda tidak diluluskan oleh admin InfoMaulid.",
    );
  }
}

async function handleRegenerate(bot: Bot, adminPhone: string, id: number): Promise<void> {
  await sendWhatsAppText(adminPhone, `🔄 Menjana semula caption #${id}…`);
  try {
    const updated = await regenerateCaption(bot, id, { notifyViaWhatsApp: true });
    await sendWhatsAppText(adminPhone, `Caption baharu #${updated.id} dihantar untuk semakan.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendWhatsAppText(adminPhone, `Regenerate gagal: ${message}`);
  }
}

async function applyCaptionEdit(
  adminPhone: string,
  id: number,
  newCaption: string,
): Promise<void> {
  const submission = getSubmissionById(id);
  if (!submission) {
    await sendWhatsAppText(adminPhone, `Submission #${id} tidak dijumpai.`);
    return;
  }

  if (submission.status !== "ADMIN_REVIEW" && submission.status !== "APPROVED") {
    await sendWhatsAppText(adminPhone, `#${id} tidak boleh diedit (status: ${submission.status}).`);
    return;
  }

  const updated = updateSubmissionStatus(id, "ADMIN_REVIEW", {
    final_caption: newCaption,
  });

  await sendWhatsAppText(adminPhone, `✏️ Caption #${id} dikemas kini:`);
  await sendWhatsAppAdminReview(updated, newCaption);
}

export function isWhatsAppAdminCommand(text: string): boolean {
  const upper = text.trim().toUpperCase();
  if (upper === "BANTUAN" || upper === "HELP") return true;
  if (/^(APPROVE|REJECT|EDIT)_(\d+)$/.test(upper)) return true;
  return /^(LULUS|APPROVE|OK|TOLAK|REJECT|JANA|REGENERATE|EDIT|STATUS)\s+#?\d+$/.test(upper);
}

export function shouldHandleAsAdminEdit(fromPhone: string): boolean {
  return editState.has(fromPhone);
}

export function isAdminWhatsAppSender(fromPhone: string): boolean {
  return isWhatsAppAdmin(fromPhone) || shouldHandleAsAdminEdit(fromPhone);
}
