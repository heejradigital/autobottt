import type { ExtractedEventInfo, Submission } from "../database/submissions";
import { parseExtractedInfo } from "../database/submissions";

export function formatExtractedInfo(info: ExtractedEventInfo | null): string {
  if (!info) return "(tiada maklumat diekstrak)";

  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value?.trim()) lines.push(`• ${label}: ${value.trim()}`);
  };

  push("Title", info.title);
  push("Date", info.date);
  push("Time", info.time);
  push("Location", info.location);
  if (info.speakers?.length) push("Speakers", info.speakers.join(", "));
  push("Organizer", info.organizer);
  push("Contact", info.contact);
  push("Registration", info.registrationLink);
  if (info.otherImportantInfo?.length) {
    push("Other", info.otherImportantInfo.join("; "));
  }

  return lines.length ? lines.join("\n") : "(tiada medan dikesan pada poster)";
}

export function formatAdminPreview(submission: Submission, caption: string): string {
  const extracted = parseExtractedInfo(submission.extracted_info);
  const userText = submission.user_text?.trim() || "(none)";
  const fromLine =
    submission.source === "whatsapp"
      ? `WhatsApp: ${submission.whatsapp_sender ?? "unknown"}`
      : `Telegram: ${submission.telegram_full_name ?? "Unknown"} (@${submission.telegram_username ?? "n/a"})`;

  return [
    `📋 Submission #${submission.id}`,
    `Status: ${submission.status}`,
    `From: ${fromLine}`,
    "",
    "📌 Extracted info:",
    formatExtractedInfo(extracted),
    "",
    "📝 User text:",
    userText,
    "",
    "✍️ Generated caption:",
    caption,
  ].join("\n");
}

export function truncateForCaption(text: string, max = 900): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
