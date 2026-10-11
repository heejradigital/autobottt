/**
 * Patch @whiskeysockets/baileys so WhatsApp Channel (newsletter) media uploads
 * use /newsletter/newsletter-* CDN paths. Without this, images "send" but never
 * appear in the channel (ACK 479 / wrong /o1/ directPath).
 *
 * Based on: https://github.com/WhiskeySockets/Baileys/pull/2434
 * and https://github.com/WhiskeySockets/Baileys/issues/2199
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "node_modules", "@whiskeysockets", "baileys", "lib");

function mustExist(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing Baileys file: ${filePath}`);
  }
}

// Skip patching if Baileys is not installed (e.g., production builds without dev deps)
if (!fs.existsSync(root)) {
  console.log("[baileys-patch] Baileys not installed, skipping patch");
  process.exit(0);
}

function patchDefaults() {
  const file = path.join(root, "Defaults", "index.js");
  mustExist(file);
  let src = fs.readFileSync(file, "utf8");
  if (src.includes("NEWSLETTER_MEDIA_PATH_MAP")) {
    console.log("[baileys-patch] Defaults already patched");
    return;
  }

  const insert = `
export const NEWSLETTER_MEDIA_PATH_MAP = {
    image: '/newsletter/newsletter-image',
    video: '/newsletter/newsletter-video',
    document: '/newsletter/newsletter-document',
    audio: '/newsletter/newsletter-audio',
    gif: '/newsletter/newsletter-gif',
    ptt: '/newsletter/newsletter-ptt',
    ptv: '/newsletter/newsletter-ptv',
    sticker: '/newsletter/newsletter-sticker',
    'thumbnail-link': '/newsletter/newsletter-thumbnail-link'
};
`;

  src = src.replace(
    "export const MEDIA_HKDF_KEY_MAPPING = {",
    `${insert}\nexport const MEDIA_HKDF_KEY_MAPPING = {`,
  );
  fs.writeFileSync(file, src);
  console.log("[baileys-patch] Patched Defaults/index.js");
}

function patchUpload() {
  const file = path.join(root, "Utils", "messages-media.js");
  mustExist(file);
  let src = fs.readFileSync(file, "utf8");

  if (!src.includes("NEWSLETTER_MEDIA_PATH_MAP")) {
    src = src.replace(
      "import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP } from '../Defaults/index.js';",
      "import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP, NEWSLETTER_MEDIA_PATH_MAP } from '../Defaults/index.js';",
    );
  }

  if (!src.includes("newsletter ? NEWSLETTER_MEDIA_PATH_MAP")) {
    src = src.replace(
      "return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {",
      "return async (filePath, { mediaType, fileEncSha256B64, timeoutMs, newsletter }) => {",
    );

    src = src.replace(
      "const url = `https://${hostname}${MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`;",
      `const mediaPath = (newsletter ? NEWSLETTER_MEDIA_PATH_MAP[mediaType] : undefined) || MEDIA_PATH_MAP[mediaType];
            let url = \`https://\${hostname}\${mediaPath}/\${fileEncSha256B64}?auth=\${auth}&token=\${fileEncSha256B64}\`;
            if (newsletter) {
                url += '&server_thumb_gen=1';
                if (mediaType === 'video' || mediaType === 'gif' || mediaType === 'ptv') {
                    url += '&server_transcode=1';
                }
            }`,
    );

    src = src.replace(
      `urls = {
                        mediaUrl: result.url,
                        directPath: result.direct_path,
                        meta_hmac: result.meta_hmac,
                        fbid: result.fbid,
                        ts: result.ts
                    };`,
      `urls = {
                        mediaUrl: result.url || result.direct_path,
                        directPath: result.direct_path,
                        meta_hmac: result.meta_hmac,
                        fbid: result.fbid,
                        ts: result.ts,
                        thumbnailDirectPath: result.thumbnail_info?.thumbnail_direct_path,
                        thumbnailSha256: result.thumbnail_info?.thumbnail_sha256
                    };`,
    );
  }

  fs.writeFileSync(file, src);
  console.log("[baileys-patch] Patched Utils/messages-media.js");
}

function patchPrepareMedia() {
  const file = path.join(root, "Utils", "messages.js");
  mustExist(file);
  let src = fs.readFileSync(file, "utf8");

  if (src.includes("newsletter: true")) {
    console.log("[baileys-patch] Utils/messages.js already patched");
    return;
  }

  const oldBlock = `        const { mediaUrl, directPath } = await options.upload(filePath, {
            fileEncSha256B64: fileSha256B64,
            mediaType: mediaType,
            timeoutMs: options.mediaUploadTimeoutMs
        });
        await fs.unlink(filePath);
        const obj = WAProto.Message.fromObject({
            // todo: add more support here
            [\`\${mediaType}Message\`]: MessageTypeProto[mediaType].fromObject({
                url: mediaUrl,
                directPath,
                fileSha256,
                fileLength,
                ...uploadData,
                media: undefined
            })
        });`;

  const newBlock = `        const uploadResult = await options.upload(filePath, {
            fileEncSha256B64: fileSha256B64,
            mediaType: mediaType,
            timeoutMs: options.mediaUploadTimeoutMs,
            newsletter: true
        });
        await fs.unlink(filePath);
        const { mediaUrl, directPath, thumbnailDirectPath, thumbnailSha256 } = uploadResult;
        const mediaPayload = {
            directPath,
            fileSha256,
            fileLength,
            ...uploadData,
            media: undefined
        };
        // Newsletter media should not include the regular CDN url field.
        if (mediaUrl && !String(directPath || '').startsWith('/m1/') && !thumbnailDirectPath) {
            mediaPayload.url = mediaUrl;
        }
        if (thumbnailDirectPath) {
            mediaPayload.thumbnailDirectPath = thumbnailDirectPath;
        }
        if (thumbnailSha256) {
            mediaPayload.thumbnailSha256 = thumbnailSha256;
        }
        const obj = WAProto.Message.fromObject({
            // todo: add more support here
            [\`\${mediaType}Message\`]: MessageTypeProto[mediaType].fromObject(mediaPayload)
        });`;

  if (!src.includes(oldBlock)) {
    throw new Error("Could not find newsletter prepareWAMessageMedia block to patch");
  }

  src = src.replace(oldBlock, newBlock);
  fs.writeFileSync(file, src);
  console.log("[baileys-patch] Patched Utils/messages.js");
}

function patchNewsletterMediatypeAttr() {
  const file = path.join(root, "Socket", "messages-send.js");
  mustExist(file);
  let src = fs.readFileSync(file, "utf8");
  if (src.includes("...(mediaType ? { mediatype: mediaType } : {})")) {
    console.log("[baileys-patch] messages-send.js already patched");
    return;
  }

  // Ensure newsletter plaintext includes mediatype when available (helps channel rendering)
  const oldPlain = `                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: {},
                    content: bytes
                });`;
  const newPlain = `                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: {
                        ...(mediaType ? { mediatype: mediaType } : {})
                    },
                    content: bytes
                });`;

  if (src.includes(oldPlain)) {
    src = src.replace(oldPlain, newPlain);
    fs.writeFileSync(file, src);
    console.log("[baileys-patch] Patched Socket/messages-send.js");
  } else {
    console.log("[baileys-patch] messages-send.js plaintext block not found (skipped)");
  }
}

patchDefaults();
patchUpload();
patchPrepareMedia();
patchNewsletterMediatypeAttr();
console.log("[baileys-patch] Done");
