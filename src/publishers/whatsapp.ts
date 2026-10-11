import fs from "fs";
import path from "path";
import { assertWhatsAppConfig, config } from "../config";
import { logger } from "../utils/logger";
import {
  isWhatsAppReady,
  sendWhatsAppChannelImage,
  sendWhatsAppImage,
} from "./whatsappClient";

export interface WhatsAppPublishResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  providerResponseId?: string;
}

/**
 * Publish original poster + caption to the configured WhatsApp contact.
 * Independent from Telegram publishing.
 *
 * Providers:
 * - baileys: personal WhatsApp Web (scan QR, no Meta API)
 * - meta: WhatsApp Cloud API (official)
 * - disabled via WHATSAPP_ENABLED=false → skipped
 */
export async function publishToWhatsApp(
  posterFilePath: string,
  caption: string,
): Promise<WhatsAppPublishResult> {
  if (!config.whatsappEnabled) {
    logger.info("WhatsApp publishing skipped (WHATSAPP_ENABLED=false)");
    return { ok: true, skipped: true };
  }

  try {
    assertWhatsAppConfig();

    if (config.whatsappProvider === "baileys") {
      return await publishViaBaileys(posterFilePath, caption);
    }

    if (config.whatsappProvider === "meta") {
      return await publishViaMetaCloudApi(posterFilePath, caption);
    }

    return {
      ok: false,
      error: `Unsupported WHATSAPP_PROVIDER: ${config.whatsappProvider}. Supported: baileys, meta`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("WhatsApp publish failed", message);
    return { ok: false, error: message };
  }
}

async function publishViaBaileys(
  posterFilePath: string,
  caption: string,
): Promise<WhatsAppPublishResult> {
  if (!isWhatsAppReady()) {
    return {
      ok: false,
      error: "WhatsApp belum login. Scan QR dulu (bot akan hantar QR ke admin Telegram).",
    };
  }

  const targets = config.whatsappPersonalPublishEnabled ? config.whatsappTargetNumbers : [];
  const successes: string[] = [];
  const failures: string[] = [];
  const messageIds: string[] = [];

  for (const to of targets) {
    const result = await sendWhatsAppImage(to, posterFilePath, caption);
    if (result.ok) {
      successes.push(to);
      if (result.messageId) messageIds.push(result.messageId);
      logger.info("Published to WhatsApp via Baileys", {
        to,
        messageId: result.messageId,
      });
    } else {
      failures.push(`${to}: ${result.error}`);
      logger.error("WhatsApp send failed for number", { to, error: result.error });
    }
  }

  if (config.whatsappChannelEnabled) {
    const channelResult = await sendWhatsAppChannelImage(posterFilePath, caption);
    if (channelResult.ok) {
      successes.push(`channel:${channelResult.jid}`);
      if (channelResult.messageId) messageIds.push(channelResult.messageId);
      logger.info("Published to WhatsApp Channel via Baileys", {
        jid: channelResult.jid,
        messageId: channelResult.messageId,
      });
    } else {
      failures.push(`channel: ${channelResult.error}`);
      logger.error("WhatsApp Channel send failed", channelResult.error);
    }
  }

  if (failures.length === 0) {
    if (successes.length === 0 && !config.whatsappChannelEnabled) {
      return { ok: true, skipped: true };
    }
    return {
      ok: true,
      providerResponseId: messageIds.join(",") || undefined,
    };
  }

  return {
    ok: false,
    error: [
      successes.length ? `OK: ${successes.join(", ")}` : null,
      `Failed: ${failures.join(" | ")}`,
    ]
      .filter(Boolean)
      .join(" / "),
  };
}

async function publishViaMetaCloudApi(
  posterFilePath: string,
  caption: string,
): Promise<WhatsAppPublishResult> {
  const phoneNumberId = config.whatsappPhoneNumberId;
  const accessToken = config.whatsappAccessToken;
  const targets = config.whatsappTargetNumbers;
  const mediaId = await uploadMediaToMeta(posterFilePath, phoneNumberId, accessToken);

  const successes: string[] = [];
  const failures: string[] = [];
  const messageIds: string[] = [];

  for (const to of targets) {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: {
          id: mediaId,
          caption,
        },
      }),
    });

    const body = (await response.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      failures.push(`${to}: ${body.error?.message ?? `WhatsApp API error (${response.status})`}`);
      continue;
    }

    const messageId = body.messages?.[0]?.id;
    successes.push(to);
    if (messageId) messageIds.push(messageId);
    logger.info("Published to WhatsApp via Meta Cloud API", { messageId, to });
  }

  if (failures.length === 0) {
    return {
      ok: true,
      providerResponseId: messageIds.join(",") || undefined,
    };
  }

  return {
    ok: false,
    error: [
      successes.length ? `OK: ${successes.join(", ")}` : null,
      `Failed: ${failures.join(" | ")}`,
    ]
      .filter(Boolean)
      .join(" / "),
  };
}

async function uploadMediaToMeta(
  posterFilePath: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  const form = new FormData();
  const fileBuffer = fs.readFileSync(posterFilePath);
  const fileName = path.basename(posterFilePath);
  const mime = guessMime(fileName);

  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([fileBuffer], { type: mime }), fileName);

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  const body = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new Error(body.error?.message ?? `WhatsApp media upload failed (${response.status})`);
  }

  return body.id;
}

function guessMime(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}
