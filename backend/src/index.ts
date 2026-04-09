import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(currentDir, '../.env'), override: true });
await import('./server.js');
