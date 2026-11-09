/**
 * Preparacao do ambiente para os scripts locais.
 *
 * Nao ha etapa de build e nenhuma configuracao e obrigatoria para desenvolver:
 * se faltar SESSION_SECRET, um valor aleatorio e gerado e gravado no
 * .env.local, que esta no .gitignore. O segredo precisa ser estavel entre
 * execucoes, senao toda sessao aberta cairia a cada reinicio do servidor.
 *
 * O .env/.env.local ja existente e lido, mas nunca sobrepoe o que ja estiver no
 * ambiente (nem o que a Vercel injetar).
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export const ARQUIVO_ENV_LOCAL = '.env.local';

function lerEnv(raiz) {
  for (const nome of ['.env', ARQUIVO_ENV_LOCAL]) {
    const caminho = join(raiz, nome);
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
      const t = linha.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const chave = t.slice(0, i).trim();
      const valor = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[chave] === undefined) process.env[chave] = valor;
    }
  }
}

/**
 * @param {string} raiz  pasta do projeto
 * @param {{padrao?: boolean}} opcoes  padrao=false nao avisa sobre banco embutido
 * @returns {{avisos: string[]}}
 */
export function prepararEnvLocal(raiz, { padrao = true } = {}) {
  const avisos = [];
  lerEnv(raiz);

  // Sem URL de Postgres o projeto usa o PGlite (Postgres embutido) em .local-pg.
  // Nada externo para configurar.
  if (padrao && !temBanco()) {
    avisos.push(
      `Nenhum banco na nuvem configurado; usando o Postgres embutido em ${process.env.PGLITE_DIR || '.local-pg'}`
    );
  }

  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    const segredo = randomBytes(32).toString('hex');
    process.env.SESSION_SECRET = segredo;
    const destino = join(raiz, ARQUIVO_ENV_LOCAL);
    if (!existsSync(destino)) {
      appendFileSync(
        destino,
        `# Gerado por npm run dev:local em ${new Date().toISOString()}.\n` +
        `# Apague este arquivo se for apontar para o Supabase de verdade.\n` +
        `SESSION_SECRET=${segredo}\n`
      );
      avisos.push(`SESSION_SECRET gerado e salvo em ${ARQUIVO_ENV_LOCAL}`);
    } else {
      avisos.push(`SESSION_SECRET fraco demais; usando um valor aleatorio so nesta execucao (ajuste o ${ARQUIVO_ENV_LOCAL})`);
    }
  }

  return { avisos };
}

function temBanco() {
  return Boolean(process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL);
}
