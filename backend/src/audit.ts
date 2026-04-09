import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = path.resolve(currentDir, '..', '.data');
const configuredFile = process.env.DRIVEREADY_AUDIT_FILE;
const auditFile = configuredFile ?? path.join(defaultDir, 'audit.log');

function ensureDir() {
  const dir = path.dirname(auditFile);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeAuditEntry(action: string, detail: Record<string, unknown>) {
  ensureDir();

  appendFileSync(
    auditFile,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      detail,
    })}\n`,
  );
}
