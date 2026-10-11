import { getDb } from "./db";

export type SubmissionStatus =
  | "SUBMITTED"
  | "AI_PROCESSING"
  | "ADMIN_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "REJECTED";

export type PublishStatus = "pending" | "published" | "failed" | "skipped";

export interface ExtractedEventInfo {
  title: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  speakers: string[] | null;
  organizer: string | null;
  contact: string | null;
  registrationLink: string | null;
  /** "muslimat" if women-only event is clearly indicated on the poster; otherwise null/umum */
  audience: "muslimat" | "umum" | null;
  /** False when image is not an Islamic event/majlis/program poster. */
  isEventPoster: boolean;
  /** Brief reason when isEventPoster is false. */
  classificationReason: string | null;
  otherImportantInfo: string[] | null;
  rawNotes?: string | null;
}

export type SubmissionSource = "telegram" | "whatsapp";

export interface Submission {
  id: number;
  telegram_user_id: number;
  telegram_username: string | null;
  telegram_full_name: string | null;
  poster_file_path: string;
  poster_file_id: string;
  user_text: string | null;
  extracted_info: string | null;
  generated_caption: string | null;
  final_caption: string | null;
  status: SubmissionStatus;
  source: SubmissionSource;
  whatsapp_sender: string | null;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
  telegram_publish_status: PublishStatus;
  whatsapp_publish_status: PublishStatus;
  telegram_message_id: string | null;
  error_message: string | null;
}

export interface CreateSubmissionInput {
  telegramUserId?: number;
  telegramUsername?: string | null;
  telegramFullName?: string | null;
  posterFilePath: string;
  posterFileId: string;
  userText?: string | null;
  source?: SubmissionSource;
  whatsappSender?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createSubmission(input: CreateSubmissionInput): Submission {
  const db = getDb();
  const source = input.source ?? "telegram";
  const result = db
    .prepare(
      `
      INSERT INTO submissions (
        telegram_user_id,
        telegram_username,
        telegram_full_name,
        poster_file_path,
        poster_file_id,
        user_text,
        source,
        whatsapp_sender,
        status,
        created_at,
        telegram_publish_status,
        whatsapp_publish_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 'pending', 'pending')
    `,
    )
    .run(
      input.telegramUserId ?? 0,
      input.telegramUsername ?? null,
      input.telegramFullName ?? null,
      input.posterFilePath,
      input.posterFileId,
      input.userText ?? null,
      source,
      input.whatsappSender ?? null,
      nowIso(),
    );

  return getSubmissionById(Number(result.lastInsertRowid))!;
}

export function getSubmissionById(id: number): Submission | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as Submission | undefined;
  return row ?? null;
}

export function updateSubmissionStatus(
  id: number,
  status: SubmissionStatus,
  extra: Partial<{
    extracted_info: string | null;
    generated_caption: string | null;
    final_caption: string | null;
    approved_at: string | null;
    published_at: string | null;
    telegram_publish_status: PublishStatus;
    whatsapp_publish_status: PublishStatus;
    telegram_message_id: string | null;
    error_message: string | null;
  }> = {},
): Submission {
  const current = getSubmissionById(id);
  if (!current) {
    throw new Error(`Submission ${id} not found`);
  }

  const next = {
    status,
    extracted_info: extra.extracted_info ?? current.extracted_info,
    generated_caption: extra.generated_caption ?? current.generated_caption,
    final_caption: extra.final_caption ?? current.final_caption,
    approved_at: extra.approved_at ?? current.approved_at,
    published_at: extra.published_at ?? current.published_at,
    telegram_publish_status: extra.telegram_publish_status ?? current.telegram_publish_status,
    whatsapp_publish_status: extra.whatsapp_publish_status ?? current.whatsapp_publish_status,
    telegram_message_id: extra.telegram_message_id ?? current.telegram_message_id,
    error_message: extra.error_message ?? current.error_message,
  };

  getDb()
    .prepare(
      `
      UPDATE submissions SET
        status = ?,
        extracted_info = ?,
        generated_caption = ?,
        final_caption = ?,
        approved_at = ?,
        published_at = ?,
        telegram_publish_status = ?,
        whatsapp_publish_status = ?,
        telegram_message_id = ?,
        error_message = ?
      WHERE id = ?
    `,
    )
    .run(
      next.status,
      next.extracted_info,
      next.generated_caption,
      next.final_caption,
      next.approved_at,
      next.published_at,
      next.telegram_publish_status,
      next.whatsapp_publish_status,
      next.telegram_message_id,
      next.error_message,
      id,
    );

  return getSubmissionById(id)!;
}

export function parseExtractedInfo(raw: string | null): ExtractedEventInfo | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExtractedEventInfo;
  } catch {
    return null;
  }
}
