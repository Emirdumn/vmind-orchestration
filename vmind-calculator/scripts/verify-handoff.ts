import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;

const root = resolve(import.meta.dirname, '..');
const readJson = async (path: string): Promise<JsonRecord> =>
  JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonRecord;

const openapi = await readJson('docs/openapi.json');
const collection = await readJson('docs/postman/VMind-Teklif-Ajani.postman_collection.json');
const environment = await readJson('docs/postman/VMind-Local.postman_environment.json');

if (openapi['openapi'] !== '3.1.0') throw new Error('OpenAPI sürümü 3.1.0 olmalıdır.');
const paths = openapi['paths'] as Record<string, JsonRecord>;
const expectedPaths = [
  '/api/health/live',
  '/api/health/ready',
  '/api/auth/config',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/me',
  '/api/status',
  '/api/import/spreadsheet',
  '/api/flow/guided',
  '/api/flow',
  '/api/flow/{sessionId}',
  '/api/flow/{sessionId}/answer',
  '/api/flow/{sessionId}/edit',
  '/api/flow/{sessionId}/close',
  '/api/admin/overview',
  '/api/admin/runs',
  '/api/admin/runs/{runId}',
  '/api/admin/usage',
  '/api/admin/opportunities',
  '/api/admin/opportunities/{opportunityId}',
];
for (const path of expectedPaths) {
  if (!paths[path]) throw new Error(`OpenAPI yolu eksik: ${path}`);
}

const operationIds = new Set<string>();
let operationCount = 0;
for (const [path, pathItem] of Object.entries(paths)) {
  for (const method of ['get', 'post', 'patch']) {
    const operation = pathItem[method] as JsonRecord | undefined;
    if (!operation) continue;
    operationCount += 1;
    const operationId = String(operation['operationId'] ?? '');
    if (!operationId || operationIds.has(operationId)) {
      throw new Error(`Eksik veya yinelenen operationId: ${method.toUpperCase()} ${path}`);
    }
    operationIds.add(operationId);
    if (!operation['responses']) throw new Error(`Responses eksik: ${operationId}`);
    if (!Object.hasOwn(operation, 'security')) throw new Error(`Security açık değil: ${operationId}`);
  }
}

const collectionText = JSON.stringify(collection);
for (const operationId of operationIds) {
  if (!collectionText.includes(operationId)) {
    throw new Error(`Postman örneği eksik: ${operationId}`);
  }
}

const values = environment['values'] as Array<JsonRecord>;
const secretKeys = new Set(['serviceKey', 'adminKey', 'monitorKey', 'turnstileToken']);
for (const value of values) {
  const key = String(value['key'] ?? '');
  if (secretKeys.has(key) && String(value['value'] ?? '') !== '') {
    throw new Error(`Postman secret alanı boş teslim edilmelidir: ${key}`);
  }
}

const packageText = [JSON.stringify(openapi), collectionText, JSON.stringify(environment)].join('\n');
if (/sk-or-v1-[a-z0-9]{16,}|vmind_service_[a-z0-9]{16,}/i.test(packageText)) {
  throw new Error('Teslim paketinde gerçek anahtar örüntüsü bulundu.');
}

process.stdout.write(`${JSON.stringify({ ok: true, paths: expectedPaths.length, operations: operationCount, postman: true })}\n`);
