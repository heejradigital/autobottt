import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "./logger";

export function ensureDownloadsDir(): void {
  if (!fs.existsSync(config.downloadsDir)) {
    fs.mkdirSync(config.downloadsDir, { recursive: true });
  }
}

export async function downloadTelegramFile(
  filePath: string,
  botToken: string,
  localFileName: string,
): Promise<string> {
  ensureDownloadsDir();

  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const destination = path.join(config.downloadsDir, localFileName);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  logger.info(`Downloaded poster to ${destination}`);
  return destination;
}

export function fileToDataUrl(localPath: string): string {
  const ext = path.extname(localPath).toLowerCase().replace(".", "") || "jpg";
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : "image/jpeg";

  const base64 = fs.readFileSync(localPath).toString("base64");
  return `data:${mime};base64,${base64}`;
}
