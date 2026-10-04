/**
 * Печатает studio.json после проверки схемой (со значениями по умолчанию).
 *   node --experimental-strip-types scripts/tenant-json.ts tenants/1808-detailing/studio.json
 * Нужен тестам базы: сервер должен видеть ровно тот конфиг, что и сайт.
 */
import {readFileSync} from 'node:fs';
import process from 'node:process';
import {studioSettingsSchema} from '../src/tenants/schema.ts';

const file = process.argv[2];
if (!file) throw new Error('Укажите путь к studio.json');
process.stdout.write(JSON.stringify(studioSettingsSchema.parse(JSON.parse(readFileSync(file, 'utf8')))));
