// ABOUTME: Converts exported table CSV files into SQLite insert statements for D1 import.
// ABOUTME: Run with: tsx scripts/import-d1-from-csv.ts /absolute/path/to/database-tables-export > scripts/d1-import.sql

import fs from 'fs';
import path from 'path';

type Row = Record<string, string | null>;

const NULLABLE_COLUMNS = new Set([
  'posts.idea_id',
  'posts.template_id',
  'posts.writing_prompt',
  'posts.publish_at',
  'post_targets.channel_id',
  'post_targets.platform_post_id',
  'post_targets.error',
  'post_targets.carousel_name',
  'post_targets.thread',
]);

const TABLES = [
  'ideas',
  'templates',
  'brand_profiles',
  'channels',
  'posts',
  'idea_conversations',
  'post_targets',
  'media',
] as const;

function parseCsv(input: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(cell => cell.length > 0)) rows.push(row);
  }

  if (rows.length === 0) return [];
  const [header, ...data] = rows;
  return data.map(values => {
    const record: Row = {};
    for (let i = 0; i < header.length; i += 1) {
      const value = values[i] ?? '';
      record[header[i]] = value;
    }
    return record;
  });
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function toSqlValue(table: string, column: string, value: string | null): string {
  if (value === null) return 'NULL';
  if (value === '' && NULLABLE_COLUMNS.has(`${table}.${column}`)) {
    return 'NULL';
  }
  if (column === 'is_default' || column === 'as_carousel') {
    return value === 'true' ? '1' : '0';
  }
  if (column.endsWith('_at')) {
    return `${Number(value)}`;
  }
  return `'${escapeSql(value)}'`;
}

function buildInsert(table: string, rows: Row[]): string[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const statements = rows.map(row => {
    const values = columns.map(column => toSqlValue(table, column, row[column] ?? null));
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
  });
  return statements;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    throw new Error('Pass the CSV export directory path as the first argument.');
  }

  const sql: string[] = ['PRAGMA foreign_keys = OFF;'];

  for (const table of TABLES) {
    const filePath = path.join(dir, `${table}.csv`);
    const csv = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsv(csv);
    sql.push(...buildInsert(table, rows));
  }

  sql.push('PRAGMA foreign_keys = ON;');
  process.stdout.write(`${sql.join('\n')}\n`);
}

main();
