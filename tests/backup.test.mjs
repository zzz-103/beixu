import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { prepareBackup } from '../scripts/prepare-backup.mjs';

test('256 KiB 图片的导出SQL分片低于D1单语句限制且字节完整', () => {
  const bytes = randomBytes(256 * 1024);
  const id = '19abeb8c-4552-4d10-a4ac-73ec5d54d9ee';
  const sql = `INSERT INTO "media" ("id","mime","blob","created_at") VALUES('${id}','image/webp',X'${bytes.toString('hex')}','2026-10-20T00:00:00Z');`;
  const statements = prepareBackup(sql).split('\n');
  assert(statements.length > 1);
  for (const statement of statements) assert(Buffer.byteLength(statement) < 100000);
  assert(statements[0].includes("X''"));
  const restored = statements
    .slice(1)
    .map((row) => row.match(/X'([0-9a-f]+)'/i)[1])
    .join('');
  assert.deepEqual(Buffer.from(restored, 'hex'), bytes);
});

test('普通业务SQL和小图片原样保留', () => {
  const sql = `INSERT INTO "users" VALUES(1,'小林;你好','2026-10-20','{}');\nINSERT INTO "media" ("id","mime","blob","created_at") VALUES('19abeb8c-4552-4d10-a4ac-73ec5d54d9ee','image/png',X'89504e47','2026-10-20');`;
  assert.equal(prepareBackup(sql), sql);
});
