import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const sql = readFileSync(resolve(__dirname, '../schema.sql'), 'utf8');
  provide('schemaSql', sql);
}
