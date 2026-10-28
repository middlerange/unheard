import { spawn } from 'node:child_process';
import { readSync, writeSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';

type SqlitePayload = { script: string } | { queries: Array<{ sql: string; params?: unknown[] }> };
type Pipe = (Readable | Writable) & { _handle?: { fd: number; setBlocking(blocking: boolean): void } };

export function createSyncResearchSqlite(path: string) {
  const python = `import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')
for line in sys.stdin:
 try:
  p=json.loads(line)
  if 'script' in p:
   c.executescript(p['script']);out=[]
  else:
   out=[]
   for q in p['queries']:
    cur=c.execute(q['sql'],q.get('params',[]));out.append({'results':[dict(r) for r in cur.fetchall()],'success':True,'meta':{'changes':cur.rowcount}})
  c.commit();print(json.dumps({'result':out}),flush=True)
 except Exception as e:
  c.rollback();print(json.dumps({'error':str(e)}),flush=True)
c.close()
`;
  const worker = spawn('python3', ['-u', '-c', python, path], { stdio: ['pipe', 'pipe', 'inherit'] });
  const input = (worker.stdin as Pipe)._handle, output = (worker.stdout as Pipe)._handle;
  if (!input || !output) { worker.kill(); throw new Error('SQLite fixture requires blocking child-process pipes'); }
  input.setBlocking(true); output.setBlocking(true);
  return {
    execute(payload: SqlitePayload) {
      const request = Buffer.from(JSON.stringify(payload) + '\n');
      for (let offset = 0; offset < request.length;) offset += writeSync(input.fd, request, offset);
      const chunks: Buffer[] = [], buffer = Buffer.alloc(64 * 1024);
      let size = 0;
      while (true) {
        const length = readSync(output.fd, buffer);
        if (!length) throw new Error('SQLite fixture worker closed before responding');
        size += length;
        if (size > 32 * 1024 * 1024) { worker.kill(); throw new Error('SQLite fixture response exceeds32MB'); }
        chunks.push(Buffer.from(buffer.subarray(0, length)));
        if (buffer[length - 1] === 10) break;
      }
      const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (response.error) throw new Error(response.error);
      return response.result;
    },
    close() { worker.stdin!.destroy(); worker.stdout!.destroy(); worker.kill(); },
  };
}
