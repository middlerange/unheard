// ABOUTME: HTTP-based D1 client that connects to Cloudflare's REST API.
// ABOUTME: Enables local dev to use the production D1 database directly.

interface D1HttpConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta: Record<string, unknown>;
}

class D1HttpStatement {
  private sql: string;
  private params: unknown[];
  private config: D1HttpConfig;

  constructor(sql: string, config: D1HttpConfig) {
    this.sql = sql;
    this.params = [];
    this.config = config;
  }

  bind(...values: unknown[]): D1HttpStatement {
    const stmt = new D1HttpStatement(this.sql, this.config);
    stmt.params = values;
    return stmt;
  }

  private async query(): Promise<D1Result> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/d1/database/${this.config.databaseId}/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: this.sql, params: this.params }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`D1 HTTP API error ${res.status}: ${text}`);
    }

    const json = await res.json() as { result: D1Result[]; success: boolean; errors: unknown[] };
    if (!json.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
    }
    return json.result[0];
  }

  async all(): Promise<D1Result> {
    return this.query();
  }

  async run(): Promise<D1Result> {
    return this.query();
  }

  async first(colName?: string): Promise<unknown> {
    const result = await this.query();
    const row = result.results[0] ?? null;
    if (row && colName) return (row as Record<string, unknown>)[colName];
    return row;
  }

  async raw(): Promise<unknown[][]> {
    const result = await this.query();
    return result.results.map(row => Object.values(row));
  }
}

export function createD1Http(config: D1HttpConfig) {
  return {
    prepare(sql: string): D1HttpStatement {
      return new D1HttpStatement(sql, config);
    },
    async batch(statements: D1HttpStatement[]): Promise<D1Result[]> {
      const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
      const results: D1Result[] = [];
      for (const stmt of statements) {
        const result = await stmt.all();
        results.push(result);
      }
      return results;
    },
    async exec(sql: string): Promise<{ count: number; duration: number }> {
      const stmt = new D1HttpStatement(sql, config);
      const result = await stmt.run();
      return {
        count: (result.meta?.changes as number) ?? 0,
        duration: (result.meta?.duration as number) ?? 0,
      };
    },
  };
}
