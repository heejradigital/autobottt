import { config } from "../config";
import type { ExtractedEventInfo } from "../database/submissions";
import { buildCopywritingSystemPrompt } from "../templates/infomaulid";
import { logger } from "../utils/logger";
import { getGemini, stripCodeFences } from "./gemini";

export async function generateInfoMaulidCaption(
  extracted: ExtractedEventInfo,
  userText?: string | null,
): Promise<string> {
  const gemini = getGemini();
  const model = gemini.getGenerativeModel({
    model: config.geminiCopyModel,
    generationConfig: {
      temperature: 0.4,
    },
  });

  logger.info("Generating InfoMaulid copywriting from extracted data (Gemini)");

  const prompt = [
    buildCopywritingSystemPrompt(),
    "",
    "Generate the InfoMaulid Bahasa Melayu caption using ONLY this data.",
    "Do not invent any missing field.",
    "",
    "Extracted event information (JSON):",
    JSON.stringify(extracted, null, 2),
    "",
    "Optional user-provided text:",
    userText?.trim() ? userText.trim() : "(none)",
  ].join("\n");

  const response = await model.generateContent(prompt);
  const caption = stripCodeFences(response.response.text() || "");
  if (!caption) {
    throw new Error("Gemini returned empty copywriting");
  }

  return normalizeCaptionSpacing(caption);
}

/** Ensure date line and 📍 location line are consecutive (no blank gap). */
function normalizeCaptionSpacing(caption: string): string {
  return caption
    .replace(/\r\n/g, "\n")
    .replace(/([^\n]*\|[^\n]*)\n{2,}(📍)/g, "$1\n$2")
    .trim();
}
