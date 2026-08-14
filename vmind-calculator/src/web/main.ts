/**
 * Sunucu giriş noktası — `npm run web`.
 *
 * Açılışta bilerek PATLAR:
 *   - harcama defteri okunamıyorsa (bkz. budget.ts, kapalı tarafa düşme)
 *   - WEB_AUTH_MODE=shared-secret ama WEB_ALLOW_WEAK_AUTH verilmemişse
 *   - sınır değerleri geçersizse
 *
 * Yanlış yapılandırılmış bir sunucunun sessizce açılması, korumaların hiç
 * olmamasından daha kötü: var sanılır.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFromEnv } from './server.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `.env` desteği — giriş yolundan bağımsız (npm run web, tsx doğrudan, Docker).
// Kabuktan gelen değişkenler her zaman kazanır; dosya yalnızca boşluğu doldurur.
try {
  const lines = readFileSync(join(root, '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trimStart().startsWith('#') && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!;
    }
  }
} catch {
  // .env yoksa sorun değil — tüm değişkenler opsiyonel (bkz. .env.example).
}

try {
  await startFromEnv(root);
} catch (error) {
  console.error('\nSunucu başlatılamadı:\n');
  console.error(`  ${(error as Error).message}\n`);
  process.exitCode = 1;
}
