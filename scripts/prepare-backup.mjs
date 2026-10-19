import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Wrangler exports BLOBs as hex SQL literals. Split large media rows so every
// statement stays below D1's 100 KB SQL limit, while preserving image bytes.
export function prepareBackup(sql) {
  return sql.replace(/^INSERT INTO "media"[^\n]*;$/gm, (statement) => {
    if (Buffer.byteLength(statement) < 90000) return statement;
    const id = statement.match(/VALUES\('([0-9a-f-]{36})',/i)?.[1];
    const blob = statement.match(/X'([0-9a-f]+)'/i);
    if (!id || !blob || blob[1].length % 2) {
      throw new Error('无法识别 media 导出格式；请保留原始备份，不要导入转换结果。');
    }
    const rows = [statement.replace(blob[0], "X''")];
    for (let offset = 0; offset < blob[1].length; offset += 64000) {
      const hex = blob[1].slice(offset, offset + 64000);
      rows.push(`UPDATE "media" SET "blob"=CAST("blob" || X'${hex}' AS BLOB) WHERE "id"='${id}';`);
    }
    return rows.join('\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, output] = process.argv;
  if (!input || !output || input === output) {
    console.error(
      '用法：node scripts/prepare-backup.mjs 原始备份.sql 可导入备份.sql（文件名必须不同）',
    );
    process.exitCode = 1;
  } else {
    writeFileSync(output, prepareBackup(readFileSync(input, 'utf8')), { flag: 'wx' });
    console.log('已生成可导入备份；请妥善保管两个文件。');
  }
}
