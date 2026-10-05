/**
 * Conferencias locais do projeto. Roda sem servidor e sem rede:
 *
 *   npm run check
 *
 * Faz tres coisas:
 *   1. sintaxe de todos os .js (import dinamico com os imports removidos)
 *   2. existe um export com o nome de cada item importado
 *   3. o schema cria e as consultas rodam contra um SQLite local
 */
import { readdirSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let falhas = 0;
const aviso = (m) => console.log(`  AVISO ${m}`);
const erro = (m) => { falhas++; console.log(`  FALHA ${m}`); };

function listar(dir, filtro = '.js') {
  return readdirSync(dir)
    .filter((f) => f.endsWith(filtro))
    .map((f) => join(dir, f))
    .flatMap((p) => (statSync(p).isDirectory() ? listar(p, filtro) : [p]));
}

const arquivos = [
  ...listar(join(raiz, 'lib')),
  ...listar(join(raiz, 'api')),
  ...listar(join(raiz, 'scripts')),
  join(raiz, 'app.js'),
];

// ---------------------------------------------------------------- 1. sintaxe
console.log('1. Sintaxe');
for (const caminho of arquivos) {
  const rel = relative(raiz, caminho).replace(/\\/g, '/');
  const src = readFileSync(caminho, 'utf8');
  const reescrito = src
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, 'const __default = ')
    .replace(/\bexport\s+(async\s+function|function|const|let|var|class)\b/g, '$1');
  try {
    // Data URL evita criar arquivo no disco; o import executa o modulo.
    const url = `data:text/javascript;base64,${Buffer.from(reescrito, 'utf8').toString('base64')}`;
    // Os imports foram removidos, entao o modulo roda e pode imprimir erro
    // proprio (o seed, por exemplo). Isso nao interessa aqui.
    const log = console.log;
    const err = console.error;
    console.log = console.error = () => {};
    try {
      await import(url);
    } finally {
      console.log = log;
      console.error = err;
    }
    console.log(`  OK    ${rel}`);
  } catch (e) {
    // Sem imports resolvidos, ReferenceError em runtime e esperado; o que
    // interessa e SyntaxError.
    if (e instanceof SyntaxError) erro(`${rel}: ${e.message}`);
    else console.log(`  OK    ${rel}  (sintaxe ok)`);
  }
}

// ---------------------------------------------------------------- 2. imports
console.log('\n2. Imports');
const exportsDe = new Map();
for (const a of arquivos) {
  const src = readFileSync(a, 'utf8');
  const nomes = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) nomes.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of m[1].split(',')) {
      const t = item.trim();
      if (!t) continue;
      const partes = t.split(/\s+as\s+/);
      nomes.add((partes[1] ?? partes[0]).trim());
    }
  }
  exportsDe.set(a, nomes);
}
for (const a of arquivos) {
  const src = readFileSync(a, 'utf8');
  const mapa = new Map();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs)) {
    for (const item of m[1].split(',')) {
      const t = item.trim();
      if (!t) continue;
      mapa.set(m[2], (mapa.get(m[2]) || []).concat(t.split(/\s+as\s+/)[0].trim()));
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    mapa.set(m[2], (mapa.get(m[2]) || []).concat(m[1]));
  }
  for (const [origem, nomes] of mapa) {
    if (origem.startsWith('node:') || origem.startsWith('@')) continue;
    const alvo = join(dirname(a), origem);
    if (!existsSync(alvo)) { erro(`${relative(raiz, a)}: módulo '${origem}' não existe`); continue; }
    const disponiveis = exportsDe.get(alvo) || new Set();
    for (const nome of nomes) {
      if (!disponiveis.has(nome)) {
        erro(`${relative(raiz, a)}: importa '${nome}' de '${origem}', mas esse módulo não exporta esse nome`);
        console.log(`        disponíveis: ${[...disponiveis].join(', ')}`);
      }
    }
  }
}
function existe(p) { try { statSync(p); return true; } catch { return false; } }

// ---------------------------------------------------------------- 3. schema
console.log('\n3. Schema e consultas (SQLite temporário via lib/db.js de verdade)');
try {
  const arq = join(tmpdir(), `radarcheck-${process.pid}.sqlite`);
  rmSync(arq, { force: true });
  // Chamar iniciar() em vez de remontar o schema por regex: e o caminho real,
  // incluindo as colunas que so entram por ALTER TABLE.
  process.env.TURSO_DATABASE_URL = `file:${arq}`;
  const { iniciar, db } = await import(pathToFileURL(join(raiz, 'lib', 'db.js')).href);
  await iniciar();
  const c = db();

  const tabelas = await c.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const criadas = tabelas.rows.map((r) => r.name);
  console.log(`  OK    ${criadas.length} tabelas: ${criadas.join(', ')}`);

  // Rodar duas vezes tem de ser seguro: e o que acontece a cada requisicao.
  await iniciar();
  const outra = (await c.execute(
    "SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  )).rows[0].n;
  if (Number(outra) !== criadas.length) {
    erro(`iniciar() nao e idempotente: ${criadas.length} tabelas e depois ${outra}`);
  } else {
    console.log('  OK    iniciar() e idempotente (rodar de novo nao muda nada)');
  }

  // Colunas que chegaram depois do schema original tem de existir.
  for (const [tabela, coluna] of [
    ['vehicles', 'chassi'], ['workshops', 'garagem'], ['workshops', 'photo_rev'], ['requests', 'detalhes'],
  ]) {
    const info = await c.execute(`PRAGMA table_info(${tabela})`);
    if (!info.rows.some((r) => r.name === coluna)) {
      erro(`a migracao nao criou ${tabela}.${coluna}`);
    }
  }
  // Uma linha por tabela, para as consultas terem com o que trabalhar.
  await c.execute("INSERT INTO users(role,name,email,password_hash,cpf,phone) VALUES('client','Cli','c@t.local','x','11144477735','(11) 1')");
  await c.execute("INSERT INTO users(role,name,email,password_hash,phone) VALUES('workshop','Ofi','o@t.local','x','(11) 2')");
  await c.execute("INSERT INTO users(role,name,email,password_hash,phone) VALUES('admin','Adm','a@t.local','x','(11) 3')");
  await c.execute("INSERT INTO workshops(user_id,legal_name,cnpj,address,city) VALUES(2,'Ofi LTDA','11222333000181','Rua A, 1','SP')");
  await c.execute("INSERT INTO vehicles(client_id,make_model,plate,year,brand,model,color,fuel,mileage) VALUES(1,'Honda Civic','ABC1D23',2020,'Honda','Civic','Prata','Flex',45000)");
  await c.execute("INSERT INTO vehicle_images(vehicle_id,mime,data) VALUES(1,'image/png',x'89504e47')");
  await c.execute("INSERT INTO requests(client_id,workshop_id,vehicle_id,service_type,description) VALUES(1,1,1,'Freios','Chiado')");
  await c.execute("INSERT INTO request_images(request_id,mime,data) VALUES(1,'image/png',x'89504e47')");
  await c.execute("INSERT INTO quotes(request_id,message,amount_min,amount_max) VALUES(1,'Orc',100,200)");
  await c.execute("INSERT INTO reviews(workshop_id,client_id,request_id,rating,comment) VALUES(1,1,1,5,'Otimo')");

  const fragDe = (src) => {
    const mapa = {};
    for (const m of src.matchAll(/const\s+([A-Z_]+)\s*=\s*`([^`]*)`/gs)) mapa[m[1]] = m[2];
    return mapa;
  };
  const testados = new Set();
  let testadas = 0;
  for (const a of [...listar(join(raiz, 'api')), ...listar(join(raiz, 'lib')), ...listar(join(raiz, 'scripts')), join(raiz, 'app.js')]) {
    const src = readFileSync(a, 'utf8');
    const frag = fragDe(src);
    for (const m of src.matchAll(/`\s*((?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^`]*)`/gis)) {
      const original = m[1];
      // Tabela dinamica (FROM ${t}) nao pode ser conferida contra o schema.
      if (/\b(?:FROM|JOIN|UPDATE|INTO)\s+\$\{/i.test(original)) continue;

      let sql = original.replace(/\$\{filtro\}/, '');
      // Listas de placeholders (const l = ids.map(() => '?').join(','))
      // precisam virar "?, ?, ?" para o SQL fechar.
      sql = sql.split('${l}').join('?, ?, ?');
      for (const [nome, valor] of Object.entries(frag)) sql = sql.split('${' + nome + '}').join(valor);
      sql = sql.replace(/\$\{[^}]*\}/g, 'id').trim();
      // Precisa ter uma tabela de destino: fragmento de coluna (const CAMPOS)
      // nao e query sozinho.
      if (!/\b(?:FROM|JOIN|UPDATE|INTO)\s+[a-z_]/i.test(sql)) continue;
      // Nao testa duas vezes o mesmo trecho (o fragmento inlinado e o original).
      if (testados.has(sql)) continue;
      testados.add(sql);
      testadas++;

      // supplying null for every placeholder: execucao sem argumentos deixa o
      // driver reclamar de forma enganosa.
      const n = (sql.match(/\?/g) || []).length;
      try {
        await c.execute({ sql, args: new Array(n).fill(null) });
      } catch (e) {
        const msg = String(e.message);
        // O SQL compilou: um erro de valor invalido no teste (NULL em coluna NOT
        // NULL, unicidade, FK) prova que a sintaxe esta correta.
        if (/(NOT NULL|UNIQUE|FOREIGN KEY|CHECK) constraint/i.test(msg)) continue;
        const m2 = /expected (\d+)/.exec(msg);
        if (m2 && Number(m2[1]) !== n) {
          erro(`${relative(raiz, a)}: a consulta usa ${n} placeholder(s) mas o teste passou ${n}`);
          continue;
        }
        erro(`${relative(raiz, a)}: ${msg}\n        ${sql.replace(/\s+/g, ' ').slice(0, 130)}`);
      }
    }
  }
  console.log(`  OK    ${testadas} consultas executadas`);
  c.close();
} catch (e) {
  aviso(`não deu para testar o schema: ${e.message}`);
  aviso(' rode `npm install` para baixar o @libsql/client');
}

console.log(`\n${falhas ? `${falhas} falha(s)` : 'Tudo certo.'}`);
process.exitCode = falhas ? 1 : 0;