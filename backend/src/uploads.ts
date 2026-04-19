import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import type { Request } from 'express';

type UploadBackend = 'local' | 'supabase';

interface StoredUpload {
  downloadUrl: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
}

interface SupabaseUploadConfig {
  bucket: string;
  publicBaseUrl: string;
  secretKey: string;
  url: string;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = process.env.DRIVEREADY_UPLOAD_DIR ?? path.resolve(currentDir, '..', 'uploads');
const publicBaseUrl = (process.env.DRIVEREADY_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, '');
const DEFAULT_LOCAL_FILE_URL_TTL_SECONDS = 60 * 60;

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveUploadBackend(): UploadBackend {
  const explicitBackend = trimValue(process.env.DRIVEREADY_UPLOAD_BACKEND).toLowerCase();

  if (!explicitBackend) {
    return 'local';
  }

  if (explicitBackend === 'local' || explicitBackend === 'supabase') {
    return explicitBackend;
  }

  throw new Error('DRIVEREADY_UPLOAD_BACKEND must be either "local" or "supabase".');
}

function resolveSupabaseUploadConfig(): SupabaseUploadConfig | null {
  if (uploadBackend !== 'supabase') {
    return null;
  }

  const url = trimValue(process.env.DRIVEREADY_SUPABASE_URL) || trimValue(process.env.SUPABASE_URL);
  const secretKey =
    trimValue(process.env.DRIVEREADY_SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_KEY);
  const bucket = trimValue(process.env.DRIVEREADY_SUPABASE_UPLOAD_BUCKET) || 'driveready-documents';

  if (!url || !secretKey) {
    throw new Error('Supabase uploads require DRIVEREADY_SUPABASE_URL and DRIVEREADY_SUPABASE_SECRET_KEY.');
  }

  return {
    bucket,
    publicBaseUrl,
    secretKey,
    url,
  };
}

function ensureUploadsDir() {
  if (uploadBackend !== 'local') {
    return;
  }

  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
}

function safeFileName(originalName: string) {
  return originalName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function getLocalFileUrlSecret() {
  const configured = trimValue(process.env.DRIVEREADY_FILE_URL_SECRET);

  if (configured) {
    return configured;
  }

  return 'driveready-local-file-secret';
}

function getLocalFileUrlTtlSeconds() {
  const configured = Number(trimValue(process.env.DRIVEREADY_LOCAL_FILE_URL_TTL_SECONDS));

  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_LOCAL_FILE_URL_TTL_SECONDS;
}

function localFileSignature(fileKey: string, expires: string) {
  return createHmac('sha256', getLocalFileUrlSecret())
    .update(`${fileKey}:${expires}`)
    .digest('hex');
}

function localFileUrl(fileKey: string, ttlSeconds = getLocalFileUrlTtlSeconds()) {
  const expires = String(Date.now() + ttlSeconds * 1000);
  const signature = localFileSignature(fileKey, expires);
  const endpoint = new URL('/api/v1/files/download', publicBaseUrl);
  endpoint.searchParams.set('key', fileKey);
  endpoint.searchParams.set('expires', expires);
  endpoint.searchParams.set('signature', signature);
  return endpoint.toString();
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

const uploadBackend = resolveUploadBackend();
const supabaseUploadConfig = resolveSupabaseUploadConfig();
const supabaseStorageClient = supabaseUploadConfig
  ? createClient(supabaseUploadConfig.url, supabaseUploadConfig.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;
let bucketReadyPromise: Promise<void> | null = null;

async function ensureSupabaseBucket() {
  if (!supabaseUploadConfig || !supabaseStorageClient) {
    throw new Error('Supabase upload backend is not configured.');
  }

  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
      const { data, error } = await supabaseStorageClient.storage.getBucket(supabaseUploadConfig.bucket);

      if (!error && data) {
        return;
      }

      const { error: createError } = await supabaseStorageClient.storage.createBucket(supabaseUploadConfig.bucket, {
        public: false,
        fileSizeLimit: '10MB',
      });

      if (createError && !createError.message.toLowerCase().includes('already exists')) {
        throw createError;
      }
    })();
  }

  await bucketReadyPromise;
}

async function createSupabaseSignedUrl(fileKey: string) {
  if (!supabaseUploadConfig || !supabaseStorageClient) {
    throw new Error('Supabase upload backend is not configured.');
  }

  await ensureSupabaseBucket();
  const { data, error } = await supabaseStorageClient.storage
    .from(supabaseUploadConfig.bucket)
    .createSignedUrl(fileKey, 60 * 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Unable to create a signed file URL.');
  }

  return data.signedUrl;
}

function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw new Error('No file was uploaded.');
  }

  return file;
}

async function storeFileInSupabase(file: Express.Multer.File, userId?: string): Promise<StoredUpload> {
  return storeBufferInSupabase({
    buffer: file.buffer,
    fileName: file.originalname,
    mimeType: file.mimetype,
    userId,
  });
}

async function storeBufferInSupabase(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  userId?: string;
  prefix?: string;
}): Promise<StoredUpload> {
  if (!supabaseUploadConfig || !supabaseStorageClient) {
    throw new Error('Supabase upload backend is not configured.');
  }

  await ensureSupabaseBucket();

  const safeName = safeFileName(input.fileName);
  const folder = [input.userId ?? 'anonymous', input.prefix].filter(Boolean).join('/');
  const fileKey = `${folder}/${randomUUID()}-${safeName}`;
  const payload = input.buffer;

  if (!payload) {
    throw new Error('Uploaded file data is missing.');
  }

  const { error } = await supabaseStorageClient.storage.from(supabaseUploadConfig.bucket).upload(fileKey, payload, {
    contentType: input.mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    downloadUrl: await createSupabaseSignedUrl(fileKey),
    fileKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
  };
}

async function storeFileLocally(file: Express.Multer.File): Promise<StoredUpload> {
  const storedFile = requireFile(file);

  return {
    downloadUrl: localFileUrl(storedFile.filename),
    fileKey: storedFile.filename,
    fileName: storedFile.originalname,
    mimeType: storedFile.mimetype,
  };
}

async function storeBufferLocally(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  prefix?: string;
}) {
  ensureUploadsDir();
  const safeName = safeFileName(input.fileName);
  const relativeDir = input.prefix ? input.prefix.replace(/^\/+|\/+$/g, '') : '';
  const fileKey = [relativeDir, `${Date.now()}-${safeName}`].filter(Boolean).join('/');
  const filePath = path.join(uploadsDir, fileKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.buffer);

  return {
    downloadUrl: localFileUrl(fileKey),
    fileKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
  } satisfies StoredUpload;
}

export async function storeUploadedDocument(file: Express.Multer.File | undefined, userId?: string) {
  const storedFile = requireFile(file);

  if (uploadBackend === 'supabase') {
    return storeFileInSupabase(storedFile, userId);
  }

  return storeFileLocally(storedFile);
}

export async function storeGeneratedFile(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  userId?: string;
  prefix?: string;
}) {
  if (uploadBackend === 'supabase') {
    return storeBufferInSupabase(input);
  }

  return storeBufferLocally(input);
}

export async function createDocumentShareUrl(fileKey: string) {
  if (uploadBackend === 'supabase') {
    return createSupabaseSignedUrl(fileKey);
  }

  return localFileUrl(fileKey);
}

export function resolveLocalDownloadFile(input: {
  expires: string;
  fileKey: string;
  signature: string;
}) {
  if (uploadBackend !== 'local') {
    return null;
  }

  const expiresAt = Number(input.expires);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  if (!safeCompare(localFileSignature(input.fileKey, input.expires), input.signature)) {
    return null;
  }

  const resolvedUploadsDir = path.resolve(uploadsDir);
  const resolvedFilePath = path.resolve(uploadsDir, input.fileKey);

  if (resolvedFilePath !== resolvedUploadsDir && !resolvedFilePath.startsWith(`${resolvedUploadsDir}${path.sep}`)) {
    return null;
  }

  return resolvedFilePath;
}

export async function deleteStoredDocument(fileKey?: string) {
  if (!fileKey) {
    return;
  }

  if (uploadBackend === 'supabase') {
    if (!supabaseUploadConfig || !supabaseStorageClient) {
      return;
    }

    await ensureSupabaseBucket();
    const { error } = await supabaseStorageClient.storage.from(supabaseUploadConfig.bucket).remove([fileKey]);

    if (error && !error.message.toLowerCase().includes('not found')) {
      throw new Error(error.message);
    }

    return;
  }

  try {
    await unlink(path.join(uploadsDir, fileKey));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export function getUploadsDir() {
  return uploadsDir;
}

export function usesSupabaseUploads() {
  return uploadBackend === 'supabase';
}

export function getUploadTargetLabel() {
  if (uploadBackend === 'supabase') {
    return `Supabase Storage (${supabaseUploadConfig?.bucket ?? 'unknown bucket'})`;
  }

  return `local file system (${uploadsDir})`;
}

ensureUploadsDir();

export const uploadMiddleware = multer(
  uploadBackend === 'supabase'
    ? {
        storage: multer.memoryStorage(),
      }
    : {
        storage: multer.diskStorage({
          destination: (_request: Request, _file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
            callback(null, uploadsDir);
          },
          filename: (_request: Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => {
            callback(null, `${Date.now()}-${safeFileName(file.originalname)}`);
          },
        }),
      },
);
