import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { is, Table } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { expect, test } from 'vitest';
import * as schema from '../schema';

// SQLite enforces the same foreign keys used by D1 without a Cloudflare account.
test('fresh D1 migrations support every application table and team templates', () => {
  const tables = Object.values(schema)
    .filter((value) => is(value, Table))
    .map((table) => {
      const config = getTableConfig(table);
      return { name: config.name, columns: config.columns.map((column) => column.name) };
    });
  const result = spawnSync('python3', ['-c', `
import json, pathlib, sqlite3, sys
expected = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys = ON')
for migration in sorted(pathlib.Path('drizzle-d1').glob('*.sql')):
    db.executescript(migration.read_text())
for table in expected:
    actual = {row[1] for row in db.execute('PRAGMA table_info("' + table['name'] + '")')}
    missing = set(table['columns']) - actual
    assert not missing, table['name'] + ' missing columns: ' + ', '.join(sorted(missing))
for suffix in ['a', 'b']:
    db.execute('INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)', (suffix,suffix,suffix,0,0))
    db.execute('INSERT INTO templates(id,team_id,name,slug,category,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', (suffix,suffix,'Launch','launch','general','Hello',0,0))
db.execute("INSERT INTO posts(id,team_id,created_at,updated_at) VALUES('post','a',0,0)")
db.execute("INSERT INTO post_targets(id,post_id,platform) VALUES('target','post','twitter')")
db.execute("INSERT INTO analytics(id,post_id,target_id,platform,recorded_at) VALUES('metric','post','target','twitter',0)")
assert db.execute('SELECT impressions FROM analytics').fetchone() == (0,)
db.execute("DELETE FROM posts WHERE id='post'")
assert db.execute('SELECT count(*) FROM analytics').fetchone() == (0,)
assert not db.execute('PRAGMA foreign_key_check').fetchall()
`], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    input: JSON.stringify(tables),
    encoding: 'utf8',
  });
  expect(result.error, 'Python 3 is required for the SQLite migration regression check').toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
