/**
 * Aplica o schema no banco configurado (Supabase ou o Postgres embutido).
 *
 * uso:
 *   npm run db:push             cria tabelas, colunas e índices que faltarem
 *
 * Normalmente nem é preciso: a primeira requisição da API já chama iniciar()
 * e faz o mesmo. O script existe para conferir o banco sem subir o site e
 * para rodar antes do seed no Supabase.
 */
import { fileURLToPath } from 'node:url';
import { prepararEnvLocal } from './envlocal.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
for (const aviso of prepararEnvLocal(raiz).avisos) console.log(aviso);

const { iniciar, all, descricaoBanco, fechar } = await import('../lib/db.js');

try {
  console.log(`\nBanco: ${descricaoBanco()}`);
  await iniciar();

  const tabelas = await all(
    `SELECT table_name AS nome
       FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name`
  );
  console.log(`\n${tabelas.length} tabelas:`);
  for (const t of tabelas) {
    const c = await all(
      `SELECT count(*) n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [t.nome]
    );
    console.log(`  ${t.nome.padEnd(20)} ${c[0].n} coluna(s)`);
  }
  console.log('\nSchema em dia.');
} catch (e) {
  console.error('\nFalha ao aplicar o schema:', e?.message || e);
  process.exitCode = 1;
} finally {
  await fechar();
}
