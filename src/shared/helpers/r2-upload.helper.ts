import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type ParsedBase64Image = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
};

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
};

const parseBase64Image = (input: string): ParsedBase64Image => {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Image must be a valid base64 data URL");
  }

  const mimeType = match[1].toLowerCase();
  const base64Payload = match[2];

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("Only jpeg, png, webp or gif images are allowed");
  }

  const buffer = Buffer.from(base64Payload, "base64");
  if (!buffer.length) {
    throw new Error("Image payload is empty");
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image size must be 3MB or less");
  }

  return {
    buffer,
    mimeType,
    extension: MIME_EXTENSION_MAP[mimeType],
  };
};

let cachedClient: S3Client | null = null;

const getR2Client = (): S3Client => {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: "auto",
    endpoint: getRequiredEnv("CLOUDFLARE_S3_ENDPOINT"),
    credentials: {
      accessKeyId: getRequiredEnv("CLOUDFLARE_R2_ACCESS_KEY"),
      secretAccessKey: getRequiredEnv("CLOUDFLARE_R2_SECRET_KEY"),
    },
    forcePathStyle: true,
  });

  return cachedClient;
};

const buildObjectUrl = (bucket: string, key: string): string => {
  const publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }

  const endpoint = getRequiredEnv("CLOUDFLARE_S3_ENDPOINT").replace(/\/$/, "");
  return `${endpoint}/${bucket}/${key}`;
};

export const uploadBase64ImageToR2 = async (
  base64Image: string,
  folder: string
): Promise<string> => {
  const bucket = getRequiredEnv("CLOUDFLARE_R2_BUCKET");
  const { buffer, mimeType, extension } = parseBase64Image(base64Image);
  const sanitizedFolder = folder.replace(/^\/+|\/+$/g, "");
  const key = `${sanitizedFolder}/${Date.now()}-${randomUUID()}.${extension}`;

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.length,
    })
  );

  return buildObjectUrl(bucket, key);
};

const extractR2ObjectKeyFromUrl = (url: string): string | null => {
  const bucket = getRequiredEnv("CLOUDFLARE_R2_BUCKET");
  const publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/$/, "");
  if (publicBaseUrl && url.startsWith(`${publicBaseUrl}/`)) {
    return url.slice(publicBaseUrl.length + 1);
  }

  const endpoint = getRequiredEnv("CLOUDFLARE_S3_ENDPOINT").replace(/\/$/, "");
  const endpointPrefix = `${endpoint}/${bucket}/`;
  if (url.startsWith(endpointPrefix)) {
    return url.slice(endpointPrefix.length);
  }

  return null;
};

export const deleteR2ObjectByUrl = async (url: string): Promise<void> => {
  const bucket = getRequiredEnv("CLOUDFLARE_R2_BUCKET");
  const key = extractR2ObjectKeyFromUrl(url);
  if (!key) {
    return;
  }

  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
};

export const deleteR2ObjectsByUrls = async (urls: string[]): Promise<void> => {
  const uniqueUrls = [...new Set(urls.filter((u) => typeof u === "string" && u.length > 0))];
  await Promise.all(uniqueUrls.map((url) => deleteR2ObjectByUrl(url)));
};

export const MAX_UPLOAD_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES;