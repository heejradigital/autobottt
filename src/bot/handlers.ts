import { Bot, Context, InputFile } from "grammy";
import { config, isAdmin } from "../config";
import {
  createSubmission,
  getSubmissionById,
  updateSubmissionStatus,
  type Submission,
} from "../database/submissions";
import { publishToTelegram } from "../publishers/telegram";
import { publishToWhatsApp } from "../publishers/whatsapp";
import {
  getLinkedWhatsAppPhone,
  getWhatsAppStatus,
  startWhatsAppClient,
} from "../publishers/whatsappClient";
import { downloadTelegramFile } from "../utils/download";
import { logger } from "../utils/logger";
import { formatAdminPreview, truncateForCaption } from "./format";
import {
  afterEditKeyboard,
  confirmPublishKeyboard,
  retryWhatsAppKeyboard,
  reviewKeyboard,
} from "./keyboards";
import { processSubmissionPipeline, regenerateCaption } from "./processSubmission";
import { clearEditState, getEditState, setEditState } from "./state";
import { notifyWhatsAppSubmitter } from "./whatsappInput";

function requireAdmin(ctx: Context): boolean {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    void ctx.reply("⛔ Anda tidak mempunyai kebenaran admin untuk tindakan ini.");
    return false;
  }
  return true;
}

async function safeAnswerCallback(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text ? { text } : undefined);
  } catch (error) {
    logger.warn(
      "answerCallbackQuery failed (likely expired button)",
      error instanceof Error ? error.message : error,
    );
  }
}

function captionOf(submission: Submission): string {
  return submission.final_caption ?? submission.generated_caption ?? "";
}

async function sendUpdatedPreview(
  ctx: Context,
  submission: Submission,
  caption: string,
  withConfirm = false,
): Promise<void> {
  const preview = truncateForCaption(formatAdminPreview(submission, caption), 900);
  await ctx.replyWithPhoto(new InputFile(submission.poster_file_path), {
    caption: preview,
    reply_markup: withConfirm
      ? confirmPublishKeyboard(submission.id)
      : afterEditKeyboard(submission.id),
  });
}

export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "🕌 Assalamualaikum. Selamat datang ke *InfoMaulid Bot*.",
        "",
        "Hantar poster majlis / event Islamik kepada bot ini.",
        "Anda boleh hantar:",
        "• Poster sahaja",
        "• Poster + caption / teks tambahan",
        "",
        "Bot akan ekstrak maklumat, jana copywriting Bahasa Melayu, dan hantar kepada admin untuk semakan.",
        "Penerbitan hanya berlaku selepas admin approve — AI tidak akan publish secara automatik.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Cara guna:",
        config.telegramInputEnabled
          ? "1. Hantar poster event (photo) ke bot Telegram, ATAU hantar poster via WhatsApp (jika diaktifkan)."
          : "1. Hantar poster event sebagai foto ke WhatsApp InfoMaulid Bot.",
        "2. Tunggu AI process & admin review (Telegram).",
        "3. Admin boleh APPROVE / EDIT / REGENERATE / REJECT.",
        "",
        "Admin commands:",
        "/status <id> — semak status submission",
        "/whatsapp — status WhatsApp / minta QR login",
      ].join("\n"),
    );
  });

  bot.command("whatsapp", async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const { status, error, channelJid, channelName } = getWhatsAppStatus();
    const linkedPhone = getLinkedWhatsAppPhone();
    await ctx.reply(
      [
        "WhatsApp status:",
        `Enabled: ${config.whatsappEnabled}`,
        `Provider: ${config.whatsappProvider}`,
        linkedPhone ? `Linked account: ${linkedPhone}` : "Linked account: (unknown)",
        config.whatsappInputEnabled
          ? `Hantar poster ke: ${linkedPhone ?? "(scan QR dulu)"}`
          : "",
        `Numbers: ${config.whatsappTargetNumbers.join(", ") || "(not set)"}`,
        `Channel enabled: ${config.whatsappChannelEnabled}`,
        `Channel invite: ${config.whatsappChannelInvite || "(not set)"}`,
        `Input via WhatsApp: ${config.whatsappInputEnabled}`,
        config.whatsappInputEnabled
          ? `Input numbers: ${config.whatsappInputNumbers.join(", ")}`
          : "",
        `Telegram input: ${config.telegramInputEnabled}`,
        `Personal WA publish: ${config.whatsappPersonalPublishEnabled}`,
        channelName ? `Channel name: ${channelName}` : "",
        channelJid ? `Channel JID: ${channelJid}` : "",
        `Connection: ${status}`,
        error ? `Error: ${error}` : "",
        "",
        config.whatsappEnabled && config.whatsappProvider === "baileys"
          ? "Jika belum login, QR akan dihantar di sini. Scan: WhatsApp → Linked Devices."
          : "Set WHATSAPP_ENABLED=true dan WHATSAPP_PROVIDER=baileys dalam .env untuk on.",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    if (config.whatsappEnabled && config.whatsappProvider === "baileys" && status !== "ready") {
      await ctx.reply("Mencuba sambung / jana QR WhatsApp…");
      void startWhatsAppClient();
    }
  });

  bot.command("status", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match?.toString().trim());
    if (!Number.isFinite(id)) {
      await ctx.reply("Usage: /status <submission_id>");
      return;
    }
    const submission = getSubmissionById(id);
    if (!submission) {
      await ctx.reply(`Submission #${id} tidak dijumpai.`);
      return;
    }
    await ctx.reply(
      [
        `Submission #${submission.id}`,
        `Status: ${submission.status}`,
        `Telegram publish: ${submission.telegram_publish_status}`,
        `WhatsApp publish: ${submission.whatsapp_publish_status}`,
        `Created: ${submission.created_at}`,
        `Approved: ${submission.approved_at ?? "-"}`,
        `Published: ${submission.published_at ?? "-"}`,
      ].join("\n"),
    );
  });

  bot.on("message:photo", async (ctx) => {
    const user = ctx.from;
    if (!user) return;

    if (!config.telegramInputEnabled) {
      if (!isAdmin(user.id)) {
        await ctx.reply(
          "Poster hanya boleh dihantar melalui WhatsApp ke nombor InfoMaulid Bot. Admin boleh guna /help.",
        );
      }
      return;
    }

    // Admin sending edited caption as photo? Ignore — edits are text-only.
    const editState = getEditState(user.id);
    if (editState?.awaitingCaption) {
      await ctx.reply("Sila hantar teks caption baharu (bukan foto) untuk EDIT.");
      return;
    }

    const photos = ctx.message.photo;
    const best = photos[photos.length - 1];
    if (!best) {
      await ctx.reply("Poster tidak sah. Sila cuba lagi.");
      return;
    }

    const userText = ctx.message.caption?.trim() || null;
    await ctx.reply("📥 Poster diterima. Sedang diproses…");

    try {
      const file = await ctx.api.getFile(best.file_id);
      if (!file.file_path) {
        throw new Error("Telegram file_path missing");
      }

      const ext = file.file_path.includes(".") ? file.file_path.split(".").pop() : "jpg";
      const localName = `${Date.now()}_${user.id}.${ext}`;
      const localPath = await downloadTelegramFile(file.file_path, bot.token, localName);

      const submission = createSubmission({
        telegramUserId: user.id,
        telegramUsername: user.username ?? null,
        telegramFullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
        posterFilePath: localPath,
        posterFileId: best.file_id,
        userText,
      });

      logger.info(`Created submission #${submission.id} from user ${user.id}`);
      void processSubmissionPipeline(bot, submission.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to accept poster", message);
      await ctx.reply(`Gagal memproses poster: ${message}`);
    }
  });

  bot.on("message:text", async (ctx) => {
    const user = ctx.from;
    if (!user) return;

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const editState = getEditState(user.id);
    if (!editState?.awaitingCaption) {
      if (!isAdmin(user.id)) {
        await ctx.reply("Sila hantar poster event sebagai foto. Gunakan /start untuk panduan.");
      }
      return;
    }

    if (!requireAdmin(ctx)) return;

    const submission = getSubmissionById(editState.submissionId);
    if (!submission) {
      clearEditState(user.id);
      await ctx.reply("Submission tidak dijumpai.");
      return;
    }

    if (submission.status !== "ADMIN_REVIEW" && submission.status !== "APPROVED") {
      clearEditState(user.id);
      await ctx.reply(`Submission #${submission.id} tidak boleh diedit (status: ${submission.status}).`);
      return;
    }

    const updated = updateSubmissionStatus(submission.id, "ADMIN_REVIEW", {
      final_caption: text,
      generated_caption: submission.generated_caption,
    });

    clearEditState(user.id);
    await ctx.reply(`✏️ Caption dikemas kini untuk #${updated.id}. Preview:`);
    await sendUpdatedPreview(ctx, updated, text, false);
  });

  bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    const submission = getSubmissionById(id);
    if (!submission) {
      await safeAnswerCallback(ctx, "Not found");
      return;
    }
    if (submission.status !== "ADMIN_REVIEW") {
      await safeAnswerCallback(ctx, `Status: ${submission.status}`);
      await ctx.reply(`Submission #${id} bukan dalam ADMIN_REVIEW.`);
      return;
    }

    await safeAnswerCallback(ctx, "Confirm publish?");
    await ctx.reply(
      [
        `Sahkan publish submission #${id}?`,
        "",
        "Caption:",
        captionOf(submission),
        "",
        "Pilih:",
      ].join("\n"),
      { reply_markup: confirmPublishKeyboard(id) },
    );
  });

  bot.callbackQuery(/^cancel_publish:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    await safeAnswerCallback(ctx, "Cancelled");

    const submission = getSubmissionById(id);
    if (!submission) {
      await ctx.reply("Submission tidak dijumpai.");
      return;
    }

    if (submission.status === "APPROVED") {
      updateSubmissionStatus(id, "ADMIN_REVIEW");
    }

    await ctx.reply(`Publish dibatalkan untuk #${id}. Masih dalam ADMIN_REVIEW.`, {
      reply_markup: reviewKeyboard(id),
    });
  });

  bot.callbackQuery(/^confirm_publish:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    let submission = getSubmissionById(id);
    if (!submission) {
      await safeAnswerCallback(ctx, "Not found");
      return;
    }

    if (submission.status !== "ADMIN_REVIEW" && submission.status !== "APPROVED") {
      await safeAnswerCallback(ctx, `Status: ${submission.status}`);
      return;
    }

    await safeAnswerCallback(ctx, "Publishing…");

    const finalCaption = captionOf(submission);
    submission = updateSubmissionStatus(id, "APPROVED", {
      final_caption: finalCaption,
      approved_at: new Date().toISOString(),
    });

    // Telegram first — if WhatsApp fails later, do NOT repost Telegram.
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

    submission = updateSubmissionStatus(id, fullyPublished ? "PUBLISHED" : "APPROVED", {
      telegram_publish_status: telegramStatus,
      whatsapp_publish_status: whatsappStatus,
      telegram_message_id: telegramMessageId,
      published_at: fullyPublished ? new Date().toISOString() : null,
      error_message: [telegramError, whatsappError].filter(Boolean).join(" | ") || null,
    });

    const lines = [
      `📣 Publishing results for #${id}`,
      `Telegram: ${labelPublish(telegramStatus)}${telegramError ? ` (${telegramError})` : ""}`,
      `WhatsApp: ${labelPublish(whatsappStatus)}${whatsappError ? ` (${whatsappError})` : ""}`,
      `Workflow status: ${submission.status}`,
    ];

    if (telegramStatus === "published" && whatsappStatus === "failed") {
      await ctx.reply(lines.join("\n"), {
        reply_markup: retryWhatsAppKeyboard(id),
      });
      return;
    }

    if (telegramStatus === "failed") {
      lines.push("", "Telegram gagal. WhatsApp tidak dicuba. Cuba CONFIRM & PUBLISH semula.");
      await ctx.reply(lines.join("\n"), {
        reply_markup: confirmPublishKeyboard(id),
      });
      return;
    }

    await ctx.reply(lines.join("\n"));

    if (fullyPublished && submission.source === "whatsapp" && submission.whatsapp_sender) {
      await notifyWhatsAppSubmitter(
        submission.whatsapp_sender,
        `✅ Poster #${id} telah diterbitkan ke Telegram @infomaulid dan WhatsApp Channel Info Maulid.`,
      );
    }
  });

  bot.callbackQuery(/^retry_whatsapp:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    let submission = getSubmissionById(id);
    if (!submission) {
      await safeAnswerCallback(ctx, "Not found");
      return;
    }

    if (submission.telegram_publish_status !== "published") {
      await safeAnswerCallback(ctx, "Telegram not published yet");
      await ctx.reply("Telegram belum berjaya. Publish Telegram dahulu.");
      return;
    }

    await safeAnswerCallback(ctx, "Retrying WhatsApp…");
    const wa = await publishToWhatsApp(submission.poster_file_path, captionOf(submission));

    if (wa.skipped) {
      submission = updateSubmissionStatus(id, "PUBLISHED", {
        whatsapp_publish_status: "skipped",
        published_at: submission.published_at ?? new Date().toISOString(),
      });
      await ctx.reply(`WhatsApp: Skipped (disabled)\nStatus: ${submission.status}`);
      return;
    }

    if (wa.ok) {
      submission = updateSubmissionStatus(id, "PUBLISHED", {
        whatsapp_publish_status: "published",
        published_at: new Date().toISOString(),
        error_message: null,
      });
      await ctx.reply(
        ["Telegram: Published", "WhatsApp: Published", `Status: ${submission.status}`].join("\n"),
      );
      return;
    }

    updateSubmissionStatus(id, "APPROVED", {
      whatsapp_publish_status: "failed",
      error_message: wa.error ?? "WhatsApp failed",
    });
    await ctx.reply(`Telegram: Published\nWhatsApp: Failed (${wa.error ?? "unknown"})`, {
      reply_markup: retryWhatsAppKeyboard(id),
    });
  });

  bot.callbackQuery(/^edit:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    const submission = getSubmissionById(id);
    if (!submission) {
      await safeAnswerCallback(ctx, "Not found");
      return;
    }
    if (submission.status === "PUBLISHED" || submission.status === "REJECTED") {
      await safeAnswerCallback(ctx, "Locked");
      await ctx.reply(`Submission #${id} sudah ${submission.status} dan tidak boleh diedit.`);
      return;
    }

    setEditState(ctx.from!.id, id);
    await safeAnswerCallback(ctx, "Send new caption");
    await ctx.reply(
      [
        `✏️ EDIT mode untuk #${id}.`,
        "Hantar caption baharu sebagai mesej teks.",
        "",
        "Caption semasa:",
        captionOf(submission) || "(kosong)",
      ].join("\n"),
    );
  });

  bot.callbackQuery(/^regenerate:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    const submission = getSubmissionById(id);
    if (!submission) {
      await safeAnswerCallback(ctx, "Not found");
      return;
    }
    if (submission.status !== "ADMIN_REVIEW") {
      await safeAnswerCallback(ctx, `Status: ${submission.status}`);
      return;
    }

    await safeAnswerCallback(ctx, "Regenerating…");
    await ctx.reply(`🔄 Menjana semula caption untuk #${id}…`);

    try {
      await regenerateCaption(bot, id);
      await ctx.reply(`Caption baharu untuk #${id} telah dihantar semula untuk review.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateSubmissionStatus(id, "ADMIN_REVIEW", { error_message: message });
      await ctx.reply(`Regenerate gagal: ${message}`, {
        reply_markup: reviewKeyboard(id),
      });
    }
  });

  bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = Number(ctx.match![1]);
    const submission = getSubmissionById(id);
    if (!submission) {
      await safeAnswerCallback(ctx, "Not found");
      return;
    }
    if (submission.status === "PUBLISHED") {
      await safeAnswerCallback(ctx, "Already published");
      return;
    }

    updateSubmissionStatus(id, "REJECTED");
    clearEditState(ctx.from!.id);
    await safeAnswerCallback(ctx, "Rejected");
    await ctx.reply(`❌ Submission #${id} ditolak. Ia tidak akan diterbitkan.`);

    if (submission.source === "whatsapp" && submission.whatsapp_sender) {
      await notifyWhatsAppSubmitter(
        submission.whatsapp_sender,
        `Submission #${id} telah ditolak oleh admin InfoMaulid.`,
      );
      return;
    }

    try {
      await bot.api.sendMessage(
        submission.telegram_user_id,
        `Submission #${id} telah ditolak oleh admin InfoMaulid.`,
      );
    } catch {
      // ignore
    }
  });
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
