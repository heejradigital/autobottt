import fs from "fs";
import path from "path";
import P from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { config, isWhatsAppAdmin, isWhatsAppInputAllowed } from "../config";
import { logger } from "../utils/logger";

// Railway persistent storage support
const persistentStorage = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.PERSISTENT_STORAGE || "";
const authDir = persistentStorage
  ? path.join(persistentStorage, "data", "whatsapp-auth")
  : path.join(process.cwd(), "data", "whatsapp-auth");

type SendResult = { key?: { id?: string | null } } | undefined;

type NewsletterMetadata = {
  id: string;
  name?: string;
  invite?: string;
  verification?: string;
};

type WaSocket = {
  sendMessage: (
    jid: string,
    content: { image: Buffer; caption?: string } | { text: string },
  ) => Promise<SendResult>;
  newsletterMetadata?: (
    type: "invite" | "jid",
    key: string,
  ) => Promise<NewsletterMetadata | null>;
  end: (error?: Error) => void;
  ev: {
    on: (event: string, cb: (arg: unknown) => void) => void;
  };
};

export type WhatsAppStatus = "disabled" | "connecting" | "qr" | "ready" | "logged_out" | "error";

let sock: WaSocket | null = null;
let status: WhatsAppStatus = "disabled";
let lastError: string | null = null;
let starting: Promise<void> | null = null;
let qrHandler: ((png: Buffer, rawQr: string) => Promise<void>) | null = null;
let messageHandler: ((payload: WhatsAppIncomingMessage) => Promise<void>) | null = null;
let textHandler: ((payload: WhatsAppIncomingText) => Promise<void>) | null = null;
let buttonHandler: ((payload: WhatsAppIncomingButton) => Promise<void>) | null = null;
let relaySocket: {
  relayMessage: (
    jid: string,
    message: unknown,
    options: { messageId: string },
  ) => Promise<string>;
} | null = null;
let linkedUserJid: string | null = null;
let shouldReconnect = true;
let cachedChannelJid: string | null = null;
let cachedChannelName: string | null = null;
let linkedWhatsAppPhone: string | null = null;
const processedMessageIds = new Set<string>();
const botSentMessageIds = new Set<string>();

const MAX_PROCESSED_IDS = 500;

export function getLinkedWhatsAppPhone(): string | null {
  return linkedWhatsAppPhone;
}

export function getWhatsAppStatus(): {
  status: WhatsAppStatus;
  error: string | null;
  channelJid: string | null;
  channelName: string | null;
} {
  return {
    status,
    error: lastError,
    channelJid: cachedChannelJid,
    channelName: cachedChannelName,
  };
}

export type WhatsAppIncomingMessage = {
  fromPhone: string;
  fromJid: string;
  messageId: string;
  caption: string | null;
  imageBuffer: Buffer;
  mimeType: string;
};

export type WhatsAppIncomingText = {
  fromPhone: string;
  fromJid: string;
  messageId: string;
  text: string;
};

export type WhatsAppIncomingButton = {
  fromPhone: string;
  fromJid: string;
  messageId: string;
  buttonId: string;
};

export function setWhatsAppButtonHandler(
  handler: ((payload: WhatsAppIncomingButton) => Promise<void>) | null,
): void {
  buttonHandler = handler;
}

export function setWhatsAppMessageHandler(
  handler: ((payload: WhatsAppIncomingMessage) => Promise<void>) | null,
): void {
  messageHandler = handler;
}

export function setWhatsAppTextHandler(
  handler: ((payload: WhatsAppIncomingText) => Promise<void>) | null,
): void {
  textHandler = handler;
}

export function setWhatsAppQrHandler(
  handler: ((png: Buffer, rawQr: string) => Promise<void>) | null,
): void {
  qrHandler = handler;
}

function trackBotMessageId(id: string | null | undefined): void {
  if (!id) return;
  botSentMessageIds.add(id);
  if (botSentMessageIds.size > MAX_PROCESSED_IDS) {
    const oldest = botSentMessageIds.values().next().value;
    if (oldest) botSentMessageIds.delete(oldest);
  }
}

export async function sendWhatsAppText(
  phoneNumber: string,
  text: string,
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  if (!isWhatsAppReady() || !sock) {
    return {
      ok: false,
      error: `WhatsApp not ready (status: ${status}${lastError ? `, ${lastError}` : ""}).`,
    };
  }

  const jid = toJid(phoneNumber);
  try {
    const result = await sock.sendMessage(jid, { text });
    trackBotMessageId(result?.key?.id ?? undefined);
    return { ok: true, messageId: result?.key?.id ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function isWhatsAppReady(): boolean {
  return status === "ready" && sock !== null;
}

export async function startWhatsAppClient(): Promise<void> {
  if (!config.whatsappEnabled || config.whatsappProvider !== "baileys") {
    status = "disabled";
    return;
  }

  if (starting) return starting;
  starting = connectWhatsApp().finally(() => {
    starting = null;
  });
  return starting;
}

export async function stopWhatsAppClient(): Promise<void> {
  shouldReconnect = false;
  if (sock) {
    try {
      sock.end(undefined);
    } catch {
      // ignore
    }
    sock = null;
  }
  status = "disabled";
}

export async function sendWhatsAppImage(
  phoneNumber: string,
  imagePath: string,
  caption: string,
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  if (!isWhatsAppReady() || !sock) {
    return {
      ok: false,
      error: `WhatsApp not ready (status: ${status}${lastError ? `, ${lastError}` : ""}). Scan QR dulu.`,
    };
  }

  const jid = toJid(phoneNumber);
  const image = fs.readFileSync(imagePath);

  try {
    const result = await sock.sendMessage(jid, { image, caption });
    trackBotMessageId(result?.key?.id ?? undefined);
    return { ok: true, messageId: result?.key?.id ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function sendWhatsAppInteractiveButtons(
  phoneNumber: string,
  options: {
    body: string;
    footer?: string;
    buttons: Array<{ id: string; text: string }>;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isWhatsAppReady() || !relaySocket || !linkedUserJid) {
    return { ok: false, error: "WhatsApp not ready for interactive buttons" };
  }

  const jid = toJid(phoneNumber);

  try {
    const baileys = await import("@whiskeysockets/baileys");
    const { proto, generateWAMessageFromContent } = baileys;

    const interactiveMessage = proto.Message.InteractiveMessage.create({
      body: { text: options.body },
      footer: options.footer ? { text: options.footer } : undefined,
      nativeFlowMessage: {
        buttons: options.buttons.map((button) => ({
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: button.text,
            id: button.id,
          }),
        })),
        messageVersion: 1,
      },
    });

    const messageContent = proto.Message.create({ interactiveMessage });
    const waMessage = generateWAMessageFromContent(jid, messageContent, {
      userJid: linkedUserJid,
    });

    const messageId = waMessage.key.id;
    if (!messageId || !waMessage.message) {
      return { ok: false, error: "Failed to build interactive WhatsApp message" };
    }

    await relaySocket.relayMessage(jid, waMessage.message, { messageId });
    trackBotMessageId(messageId);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Interactive buttons failed, falling back to text", message);
    const fallback = [
      options.body,
      "",
      ...options.buttons.map((b) => `• ${b.text} → taip: ${b.id.replace("_", " ").toUpperCase()}`),
    ].join("\n");
    const textResult = await sendWhatsAppText(phoneNumber, fallback);
    return textResult.ok ? { ok: true } : { ok: false, error: textResult.error };
  }
}

export async function sendWhatsAppChannelImage(
  imagePath: string,
  caption: string,
): Promise<{ ok: true; messageId?: string; jid: string } | { ok: false; error: string }> {
  if (!config.whatsappChannelEnabled) {
    return { ok: false, error: "WhatsApp channel publishing disabled" };
  }

  if (!isWhatsAppReady() || !sock) {
    return {
      ok: false,
      error: `WhatsApp not ready (status: ${status}${lastError ? `, ${lastError}` : ""}). Scan QR dulu.`,
    };
  }

  try {
    const jid = await resolveWhatsAppChannelJid();
    const image = fs.readFileSync(imagePath);
    const result = await sock.sendMessage(jid, { image, caption });
    return {
      ok: true,
      messageId: result?.key?.id ?? undefined,
      jid,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function resolveWhatsAppChannelJid(force = false): Promise<string> {
  if (!force && cachedChannelJid) return cachedChannelJid;

  if (!sock?.newsletterMetadata) {
    throw new Error("WhatsApp socket does not support newsletter/channel APIs");
  }

  const invite = config.whatsappChannelInvite;
  if (!invite) {
    throw new Error("WHATSAPP_CHANNEL_INVITE is empty");
  }

  const meta = await sock.newsletterMetadata("invite", invite);
  if (!meta?.id) {
    throw new Error(
      "Gagal resolve WhatsApp Channel. Pastikan akaun yang scan QR ialah admin channel Info Maulid.",
    );
  }

  cachedChannelJid = meta.id.endsWith("@newsletter") ? meta.id : `${meta.id}@newsletter`;
  cachedChannelName = meta.name ?? null;
  logger.info("Resolved WhatsApp Channel", {
    jid: cachedChannelJid,
    name: cachedChannelName,
    invite,
  });
  return cachedChannelJid;
}

function toJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/[^\d]/g, "");
  if (!digits) {
    throw new Error("Invalid WhatsApp target number");
  }
  return `${digits}@s.whatsapp.net`;
}

async function connectWhatsApp(): Promise<void> {
  shouldReconnect = true;
  status = "connecting";
  lastError = null;
  cachedChannelJid = null;
  cachedChannelName = null;

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  linkedWhatsAppPhone = phoneFromJid(state.creds.me?.id ?? null);
  logger.info("Starting WhatsApp Web (Baileys) client…", {
    version,
    linkedPhone: linkedWhatsAppPhone ?? "(unknown)",
  });

  const socket = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["InfoMaulid Bot", "Chrome", "1.0.0"],
    syncFullHistory: false,
  }) as unknown as WaSocket;

  sock = socket;
  relaySocket = socket as unknown as typeof relaySocket;
  linkedUserJid = state.creds.me?.id ?? null;

  socket.ev.on("creds.update", (credsUnknown) => {
    const creds = credsUnknown as { me?: { id?: string } };
    linkedUserJid = creds.me?.id ?? linkedUserJid;
    linkedWhatsAppPhone = phoneFromJid(linkedUserJid);
    void saveCreds();
  });

  socket.ev.on("connection.update", (updateUnknown) => {
    const update = updateUnknown as {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
      qr?: string;
    };

    void handleConnectionUpdate(update, DisconnectReason.loggedOut);
  });

  if (config.whatsappInputEnabled || config.whatsappReviewEnabled) {
    socket.ev.on("messages.upsert", (payloadUnknown) => {
      void handleIncomingMessages(payloadUnknown, socket as never, baileys);
    });
  }
}

function phoneFromJid(jid: string | null | undefined): string {
  if (!jid) return "";
  const userPart = jid.split("@")[0]?.split(":")[0] ?? jid;
  return userPart.replace(/[^\d]/g, "");
}

function rememberProcessedMessageId(id: string): boolean {
  if (processedMessageIds.has(id)) return false;
  processedMessageIds.add(id);
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const oldest = processedMessageIds.values().next().value;
    if (oldest) processedMessageIds.delete(oldest);
  }
  return true;
}

async function resolveSenderPhone(
  key: {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    fromMe?: boolean | null;
  },
  socket: {
    signalRepository?: {
      lidMapping?: { getPNForLID: (lid: string) => Promise<string | null> };
    };
  },
  baileys: typeof import("@whiskeysockets/baileys"),
): Promise<string> {
  const candidates = [key.remoteJidAlt, key.remoteJid].filter(Boolean) as string[];

  for (const jid of candidates) {
    if (baileys.isPnUser(jid)) {
      return phoneFromJid(jid);
    }
  }

  for (const jid of candidates) {
    if (baileys.isLidUser(jid)) {
      try {
        const pn = await socket.signalRepository?.lidMapping?.getPNForLID(jid);
        if (pn) return phoneFromJid(pn);
      } catch (error) {
        logger.warn("LID→PN lookup failed", error instanceof Error ? error.message : error);
      }
    }
  }

  if (key.fromMe && linkedWhatsAppPhone) {
    return linkedWhatsAppPhone;
  }

  return phoneFromJid(key.remoteJid);
}

function extractButtonId(
  content: Record<string, unknown> | null | undefined,
): string | null {
  if (!content) return null;

  const template = content.templateButtonReplyMessage as { selectedId?: string } | undefined;
  if (template?.selectedId) return template.selectedId;

  const plain = content.buttonsResponseMessage as { selectedButtonId?: string } | undefined;
  if (plain?.selectedButtonId) return plain.selectedButtonId;

  const interactive = content.interactiveResponseMessage as {
    nativeFlowResponseMessage?: { paramsJson?: string };
  } | undefined;
  const paramsJson = interactive?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const parsed = JSON.parse(paramsJson) as { id?: string };
      if (parsed.id) return parsed.id;
    } catch {
      // ignore
    }
  }

  return null;
}

async function handleIncomingMessages(
  payloadUnknown: unknown,
  socket: {
    updateMediaMessage?: (message: unknown) => Promise<unknown>;
    signalRepository?: {
      lidMapping?: { getPNForLID: (lid: string) => Promise<string | null> };
    };
  },
  baileys: typeof import("@whiskeysockets/baileys"),
): Promise<void> {
  if (!messageHandler && !textHandler && !buttonHandler) return;

  const payload = payloadUnknown as {
    type?: string;
    messages?: Array<{
      key?: {
        remoteJid?: string | null;
        remoteJidAlt?: string | null;
        fromMe?: boolean | null;
        id?: string | null;
      };
      message?: Record<string, unknown>;
    }>;
  };

  if (payload.type !== "notify" && payload.type !== "append") return;

  for (const msg of payload.messages ?? []) {
    const messageId = msg.key?.id;
    if (!messageId || !rememberProcessedMessageId(messageId)) continue;
    if (botSentMessageIds.has(messageId)) continue;

    const remoteJid = msg.key?.remoteJid;
    if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid.endsWith("@newsletter")) {
      continue;
    }

    const normalizedContent = baileys.normalizeMessageContent(
      msg.message as Parameters<typeof baileys.normalizeMessageContent>[0],
    );
    const contentType = baileys.getContentType(normalizedContent ?? undefined);

    const fromPhone = await resolveSenderPhone(msg.key ?? {}, socket, baileys);
    if (!fromPhone) continue;

    const buttonId = extractButtonId(
      (normalizedContent ?? undefined) as Record<string, unknown> | undefined,
    );
    if (buttonId && buttonHandler) {
      if (!isWhatsAppAdmin(fromPhone)) continue;
      await buttonHandler({
        fromPhone,
        fromJid: remoteJid,
        messageId,
        buttonId,
      });
      continue;
    }

    const textBody =
      (normalizedContent?.conversation as string | undefined) ??
      (normalizedContent?.extendedTextMessage as { text?: string } | undefined)?.text ??
      "";

    if (contentType === "conversation" || contentType === "extendedTextMessage") {
      const text = textBody.trim();
      if (!text || !textHandler) continue;
      if (!isWhatsAppAdmin(fromPhone)) continue;

      await textHandler({
        fromPhone,
        fromJid: remoteJid,
        messageId,
        text,
      });
      continue;
    }

    if (!messageHandler) continue;

    const isImage = contentType === "imageMessage";
    const isImageDocument =
      contentType === "documentMessage" &&
      String(
        (normalizedContent?.documentMessage as { mimetype?: string } | undefined)?.mimetype ?? "",
      ).startsWith("image/");

    if (!isImage && !isImageDocument) continue;

    if (!isWhatsAppInputAllowed(fromPhone)) {
      logger.info("WhatsApp image ignored: sender not whitelisted (no auto-reply sent)", { fromPhone, remoteJid });
      continue;
    }

    try {
      logger.info("WhatsApp poster received", { fromPhone, remoteJid, messageId });

      const buffer = (await baileys.downloadMediaMessage(
        { ...msg, message: normalizedContent ?? msg.message } as Parameters<
          typeof baileys.downloadMediaMessage
        >[0],
        "buffer",
        {},
        {
          logger: P({ level: "silent" }),
          reuploadRequest: socket.updateMediaMessage as never,
        },
      )) as Buffer;

      const imageMessage = normalizedContent?.imageMessage as
        | { mimetype?: string; caption?: string }
        | undefined;
      const documentMessage = normalizedContent?.documentMessage as
        | { mimetype?: string; caption?: string }
        | undefined;
      const mimeType =
        imageMessage?.mimetype ?? documentMessage?.mimetype ?? "image/jpeg";
      const caption = (imageMessage?.caption ?? documentMessage?.caption)?.trim() || null;

      await messageHandler({
        fromPhone,
        fromJid: remoteJid,
        messageId,
        caption,
        imageBuffer: buffer,
        mimeType,
      });
    } catch (error) {
      logger.error("Failed to process incoming WhatsApp image", error);
    }
  }
}

async function handleConnectionUpdate(
  update: {
    connection?: string;
    lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
    qr?: string;
  },
  loggedOutCode: number,
): Promise<void> {
  if (update.qr) {
    status = "qr";
    logger.info("WhatsApp QR ready — scan with your phone (Linked Devices)");
    qrcodeTerminal.generate(update.qr, { small: true });

    if (qrHandler) {
      try {
        const png = await QRCode.toBuffer(update.qr, {
          type: "png",
          width: 400,
          margin: 2,
        });
        await qrHandler(png, update.qr);
      } catch (error) {
        logger.error("WhatsApp QR handler failed", error);
      }
    }
  }

  if (update.connection === "open") {
    status = "ready";
    lastError = null;
    logger.info("WhatsApp Web connected and ready");

    if (config.whatsappChannelEnabled) {
      try {
        await resolveWhatsAppChannelJid(true);
      } catch (error) {
        logger.warn(
          "WhatsApp Channel resolve failed on connect",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (update.connection === "close") {
    const code = update.lastDisconnect?.error?.output?.statusCode;
    const reason = update.lastDisconnect?.error?.message ?? "connection closed";
    lastError = reason;
    sock = null;
    cachedChannelJid = null;
    cachedChannelName = null;

    if (code === loggedOutCode) {
      status = "logged_out";
      logger.warn("WhatsApp logged out. Delete data/whatsapp-auth and scan QR again.");
      return;
    }

    status = "connecting";
    if (shouldReconnect) {
      logger.warn(`WhatsApp disconnected (${code ?? "unknown"}). Reconnecting…`);
      setTimeout(() => {
        void startWhatsAppClient();
      }, 3000);
    }
  }
}
