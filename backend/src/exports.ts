import type { AppData, DataExportRecord } from './types.js';
import { storeGeneratedFile } from './uploads.js';

export async function generateUserDataExport(input: {
  state: AppData;
  userId?: string;
}) {
  const createdAt = new Date().toISOString();
  const fileName = `driveready-export-${createdAt.slice(0, 10)}.json`;
  const payload = Buffer.from(
    JSON.stringify(
      {
        exported_at: createdAt,
        schema_version: 1,
        data: input.state,
      },
      null,
      2,
    ),
    'utf8',
  );
  const stored = await storeGeneratedFile({
    buffer: payload,
    fileName,
    mimeType: 'application/json',
    userId: input.userId,
    prefix: 'exports',
  });

  const record: DataExportRecord = {
    id: `export-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    created_at: createdAt,
    file_key: stored.fileKey,
    file_name: stored.fileName,
    mime_type: stored.mimeType,
    download_url: stored.downloadUrl,
    source_name: 'generated-json-export',
  };

  return record;
}
