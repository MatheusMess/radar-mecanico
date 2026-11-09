/**
 * Conexao com o Postgres.
 *
 * Em producao fala com o Supabase. A URL vem de SUPABASE_DB_URL, que e o
 * "Connection string" do painel do Supabase (Project Settings -> Database),
 * ou de POSTGRES_URL, que a integracao Supabase da Vercel injeta sozinha.
 *
 * Sem nenhuma URL configurada, sobe um Postgres embutido (PGlite, WASM) em
 * .local-pg. E o mesmo dialeto do Supabase, entao desenvolver e rodar os
 * testes nao exige instalar servidor nem criar conta.
 *
 * Nada aqui e especifico de tabela: quem conhece o schema e lib/db.js.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));

/** URL do Postgres, se houver uma configurada. */
export function urlBanco() {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ''
  );
}

/** 'supabase' quando existe uma URL; 'pglite' no desenvolvimento local. */
export function driver() {
  return urlBanco() ? 'supabase' : 'pglite';
}

export function descreverBanco() {
  const url = urlBanco();
  if (!url) return `Postgres embutido (${process.env.PGLITE_DIR || '.local-pg'})`;
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
  } catch {
    return 'Postgres configurado';
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
let _driver = null;

async function criarSupabase() {
  const { default: pg } = await import('pg');

  // count(*) e bigint, que o node-postgres entrega como string por padrao.
  // O PGlite entrega numero. Igualar aqui evita "3" no JSON em producao e 3
  // no teste.
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

  const url = urlBanco();
  const local = /(?:localhost|127\.0\.0\.1|\[::1\])/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    // O Supabase exige TLS, mas usa certificado proprio na cadeia.
    ssl: local ? undefined : { rejectUnauthorized: false },
  });
  pool.on('error', (e) => console.error('[pg] conexao ociosa falhou:', e.message));

  return {
    nome: 'supabase',
    async query(sql, args = []) {
      const r = await pool.query(sql, args);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transacao(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const r = await fn({ query: (sql, args = []) => cliente.query(sql, args) });
        await cliente.query('COMMIT');
        return r;
      } catch (e) {
        try { await cliente.query('ROLLBACK'); } catch { /* conexao perdida */ }
        throw e;
      } finally {
        cliente.release();
      }
    },
    async fechar() {
      await pool.end();
    },
  };
}

async function criarPglite() {
  let PGlite;
  try {
    // O nome fica numa variavel de proposito: com `import('@electric-sql/pglite')`
    // literal, o empacotador da Vercel seguiria essa dependencia e enviaria o
    // Postgres embutido inteiro (WASM) junto com a funcao serverless. Em
    // producao o PGlite nunca e usado, entao ele nao precisa ir no deploy.
    const pacote = '@electric-sql/pglite';
    ({ PGlite } = await import(pacote));
  } catch {
    throw new Error(
      'Nenhum banco configurado e o Postgres embutido nao esta instalado. ' +
      'Rode `npm install` ou defina SUPABASE_DB_URL.'
    );
  }
  const dir = process.env.PGLITE_DIR || join(raiz, '.local-pg');
  const base = new PGlite(dir);

  return {
    nome: 'pglite',
    async query(sql, args = []) {
      const r = await base.query(sql, args);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await base.exec(sql);
    },
    async transacao(fn) {
      return base.transaction((tx) => fn({
        query: async (sql, args = []) => {
          const r = await tx.query(sql, args);
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        },
      }));
    },
    async fechar() {
      await base.close();
    },
  };
}

function conexao() {
  if (!_driver) {
    _driver = (async () => (urlBanco() ? criarSupabase() : criarPglite()))();
    // Uma falha de conexao nao deve ficar em cache para sempre.
    _driver.catch(() => { _driver = null; });
  }
  return _driver;
}

/** Executa uma consulta e devolve { rows, rowCount }. */
export async function query(sql, args = []) {
  return (await conexao()).query(sql, args);
}

/** Executa SQL sem parametros (varios comandos de uma vez). */
export async function exec(sql) {
  return (await conexao()).exec(sql);
}

/** Roda `fn` dentro de uma transacao; faz ROLLBACK se algo lancar. */
export async function transacao(fn) {
  return (await conexao()).transacao(fn);
}

/** Fecha o pool. Usado pelos scripts; o Vercel recicla o processo sozinho. */
export async function fechar() {
  if (!_driver) return;
  const d = await _driver.catch(() => null);
  _driver = null;
  if (d) await d.fechar();
}
