import { readFileSync, existsSync } from 'node:fs';

/**
 * Carrega variáveis de um arquivo .env (apenas desenvolvimento;
 * em produção a plataforma injeta variáveis de ambiente).
 */
export function loadDotenv(path: string = '.env'): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (trimmed.charCodeAt(0) === 0xfeff) trimmed = trimmed.slice(1);
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}