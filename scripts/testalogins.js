/**
 * Confere se todas as contas do seed consegue entrar de verdade: login, sessao
 * e a tela principal de cada perfil.
 *
 * uso: node scripts/testalogins.js
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepararEnvLocal } from './envlocal.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const arq = join(tmpdir(), `radarlogins-${process.pid}.sqlite`);
for (const s of ['', '-wal', '-shm']) rmSync(arq + s, { force: true });
process.env.TURSO_DATABASE_URL = `file:${arq}`;
prepararEnvLocal(raiz, { padrao: false });
process.env.TURSO_DATABASE_URL = `file:${arq}`;

// Popula o mesmo banco que o seed usa, em silencio: aqui interessa o resultado.
const seedLog = console.log;
console.log = () => {};
try {
  await import('./seed.js');
  await new Promise((r) => setTimeout(r, 500));
} finally {
  console.log = seedLog;
}

const { all } = await import('../lib/db.js');
const base = process.env.BASE_URL || 'http://127.0.0.1:8787';
const usarApi = process.env.SEM_SERVIDOR !== '1';

const contas = await all(
  `SELECT u.role, u.name, u.email, w.legal_name
     FROM users u LEFT JOIN workshops w ON w.user_id = u.id
    WHERE u.email LIKE 'demo-%' OR u.email = 'admin@radarmecanico.local'
    ORDER BY CASE u.role WHEN 'workshop' THEN 1 WHEN 'client' THEN 2 ELSE 3 END, u.name`
);

async function entrar(email, senha) {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'radar' },
    body: JSON.stringify({ email, password: senha }),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], body: j };
}

let falhas = 0;
console.log(`\nConferindo ${contas.length} contas em ${base}\n`);

for (const c of contas) {
  const senha = c.role === 'admin' ? 'RadarAdm@2026' : 'Demo@2026';
  const quem = c.role === 'workshop' ? c.legal_name : c.name;
  const r = await entrar(c.email, senha);
  const okLogin = r.status === 200 && r.body?.user?.role === c.role;

  let extra = '';
  let okExtras = true;
  if (okLogin && usarApi) {
    const get = async (recurso) => {
      const r2 = await fetch(`${base}/api/${recurso}`, { headers: { cookie: r.cookie } });
      return { status: r2.status, body: await r2.json().catch(() => null) };
    };
    if (c.role === 'workshop') {
      const reqs = await get('requests');
      const prof = await get('profile');
      const n = reqs.body?.requests?.length ?? 0;
      const esp = prof.body?.especialidades?.length ?? 0;
      okExtras = n > 0 && esp > 0;
      extra = `painel ${n} pedido(s), ${esp} especialidade(s)`;
    } else if (c.role === 'client') {
      const vs = await get('vehicles');
      const prof = await get('profile');
      const n = vs.body?.vehicles?.length ?? 0;
      const end = prof.body?.enderecos?.length ?? 0;
      okExtras = n > 0 && end > 0;
      extra = `${n} veículo(s), ${end} endereço(s)`;
    } else {
      const us = await get('admin-users');
      const n = us.body?.users?.length ?? 0;
      okExtras = n > 0;
      extra = `${n} conta(s) na administração`;
    }
  }

  const bom = okLogin && okExtras;
  if (!bom) falhas++;
  console.log(`  ${bom ? 'OK   ' : 'FALHA'} ${String(c.role).padEnd(9)} ${String(quem).padEnd(28)} ${c.email}${extra ? '  — ' + extra : ''}`);
}

for (const s of ['', '-wal', '-shm']) {
  try { rmSync(arq + s, { force: true }); } catch { /* driver ainda aberto */ }
}

console.log(falhas ? `\n${falhas} conta(s) falharam.` : `\nTodas as ${contas.length} contas entraram.`);
process.exitCode = falhas ? 1 : 0;
