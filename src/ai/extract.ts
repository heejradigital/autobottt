import fs from "fs";
import path from "path";
import { config } from "../config";
import type { ExtractedEventInfo } from "../database/submissions";
import { logger } from "../utils/logger";
import { getGemini, stripCodeFences } from "./gemini";

const EXTRACTION_SCHEMA_HINT = `{
  "isEventPoster": boolean,
  "classificationReason": string | null,
  "title": string | null,
  "date": string | null,
  "time": string | null,
  "location": string | null,
  "speakers": string[] | null,
  "organizer": string | null,
  "contact": string | null,
  "registrationLink": string | null,
  "audience": "muslimat" | "umum" | null,
  "otherImportantInfo": string[] | null,
  "rawNotes": string | null
}`;

function emptyExtracted(): ExtractedEventInfo {
  return {
    title: null,
    date: null,
    time: null,
    location: null,
    speakers: null,
    organizer: null,
    contact: null,
    registrationLink: null,
    audience: null,
    otherImportantInfo: null,
    isEventPoster: false,
    classificationReason: null,
    rawNotes: null,
  };
}

function normalizeExtracted(raw: unknown): ExtractedEventInfo {
  const base = emptyExtracted();
  if (!raw || typeof raw !== "object") return base;

  const obj = raw as Record<string, unknown>;

  const asString = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const asStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return items.length ? items : null;
  };

  const asAudience = (value: unknown): "muslimat" | "umum" | null => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "muslimat") return "muslimat";
    if (normalized === "umum") return "umum";
    return null;
  };

  const asBool = (value: unknown): boolean => value === true;

  return {
    isEventPoster: asBool(obj.isEventPoster),
    classificationReason: asString(obj.classificationReason),
    title: asString(obj.title),
    date: asString(obj.date),
    time: asString(obj.time),
    location: asString(obj.location),
    speakers: asStringArray(obj.speakers),
    organizer: asString(obj.organizer),
    contact: asString(obj.contact),
    registrationLink: asString(obj.registrationLink),
    audience: asAudience(obj.audience),
    otherImportantInfo: asStringArray(obj.otherImportantInfo),
    rawNotes: asString(obj.rawNotes),
  };
}

function guessMime(localPath: string): string {
  const ext = path.extname(localPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

export async function extractEventInfoFromPoster(
  posterPath: string,
  userText?: string | null,
): Promise<ExtractedEventInfo> {
  const gemini = getGemini();
  
  // Try primary model, fallback to simpler model if fails
  let model;
  try {
    model = gemini.getGenerativeModel({
      model: config.geminiVisionModel,
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });
  } catch (error) {
    logger.warn(`Failed to load model ${config.geminiVisionModel}, trying gemini-1.5-flash`, error);
    model = gemini.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });
  }

  const prompt = [
    "You classify and extract details from poster images for InfoMaulid (Islamic event channel).",
    "",
    "STEP 1 — CLASSIFY (isEventPoster):",
    'Set isEventPoster=true ONLY if the poster advertises an Islamic event/program/majlis with intent to invite attendance, such as:',
    "- majlis / kuliah / tazkirah / ceramah / maulid / seminar / kursus / program / forum / halaqah / talk",
    "- must clearly be an EVENT announcement (usually has tarikh/masa/lokasi and/or penceramah/program)",
    "",
    "Set isEventPoster=false for anything else, including:",
    "- product/service/shop ads, sale flyers, restaurant menu",
    "- quotes / ayat / hadith graphics without event details",
    "- personal photos, memes, political content, general announcements",
    "- recruitment/job ads, charity donation appeals without a specific dated event",
    "- Islamic content that is NOT promoting a specific event to attend",
    "",
    "If isEventPoster=false, set classificationReason briefly in Bahasa Melayu (one sentence),",
    "and set all other fields to null.",
    "",
    "STEP 2 — EXTRACT (only when isEventPoster=true):",
    "Extract Islamic event information from the poster.",
    "Use ONLY information clearly visible on the poster.",
    "If the user provided extra text below, you may use that too — but do not invent anything else.",
    "If a field is not present, set it to null.",
    'Set audience to "muslimat" only if the poster clearly indicates women-only / muslimat / sisters / wanita event. Otherwise use "umum" or null.',
    "",
    "Return STRICT JSON matching this shape:",
    EXTRACTION_SCHEMA_HINT,
    "",
    `User-provided text: ${userText?.trim() ? userText.trim() : "(none)"}`,
  ].join("\n");

  const imageBase64 = fs.readFileSync(posterPath).toString("base64");

  logger.info("Calling Gemini Vision for event extraction", { model: config.geminiVisionModel });

  let response;
  try {
    response = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: guessMime(posterPath),
          data: imageBase64,
        },
      },
    ]);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Gemini Vision API call failed", errMsg);
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  const content = response.response.text();
  if (!content?.trim()) {
    throw new Error("Gemini Vision returned empty content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(content));
  } catch {
    logger.error("Gemini Vision returned invalid JSON", { content: content.substring(0, 200) });
    throw new Error("Gemini Vision returned invalid JSON");
  }

  return normalizeExtracted(parsed);
}

export function isIslamicEventPoster(info: ExtractedEventInfo): boolean {
  if (info.isEventPoster === true) return true;
  if (info.isEventPoster === false && info.classificationReason) return false;
  // Legacy rows or ambiguous: require clear event signals
  return Boolean(info.title && (info.date || info.location || info.time));
}
