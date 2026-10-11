import { InlineKeyboard } from "grammy";

export function reviewKeyboard(submissionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ APPROVE", `approve:${submissionId}`)
    .row()
    .text("✏️ EDIT", `edit:${submissionId}`)
    .row()
    .text("🔄 REGENERATE", `regenerate:${submissionId}`)
    .row()
    .text("❌ REJECT", `reject:${submissionId}`);
}

export function confirmPublishKeyboard(submissionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ CONFIRM & PUBLISH", `confirm_publish:${submissionId}`)
    .row()
    .text("↩️ CANCEL", `cancel_publish:${submissionId}`);
}

export function retryWhatsAppKeyboard(submissionId: number): InlineKeyboard {
  return new InlineKeyboard().text("🔁 RETRY WHATSAPP", `retry_whatsapp:${submissionId}`);
}

export function afterEditKeyboard(submissionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ APPROVE", `approve:${submissionId}`)
    .row()
    .text("✏️ EDIT AGAIN", `edit:${submissionId}`)
    .row()
    .text("❌ REJECT", `reject:${submissionId}`);
}
