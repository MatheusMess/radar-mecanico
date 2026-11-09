/**
 * Servidor local de desenvolvimento.
 *
 * A Vercel nao roda na sua maquina, mas o app e um conjunto de funcoes que
 * recebem (req, res). Este script monta um http.createServer que serve os
 * arquivos estaticos e despacha /api/<recurso> para o handler
 * corresponding, usando o Postgres embutido (PGlite) ou o Supabase, se
 * SUPABASE_DB_URL estiver definido. Serve para desenvolver e para
 * verificar o frontend sem deploy.
 *
 * uso: npm run dev:local   (http://127.0.0.1:8787)
 *
 * Nao exige configuracao: sem .env ele usa o Postgres embutido em .local-pg e
 * gera um SESSION_SECRET, que fica no .env.local para a sessao sobreviver ao
 * reinicio.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepararEnvLocal } from './envlocal.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const porta = Number(process.env.PORT || 8787);

for (const aviso of prepararEnvLocal(raiz).avisos) console.log(aviso);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** O roteador unico: api/index.js ja sabe para onde mandar cada request. */
const { default: roteador } = await import(pathToFileURL(join(raiz, 'api', 'index.js')).href);
const { descricaoBanco } = await import(pathToFileURL(join(raiz, 'lib', 'db.js')).href);
const { corpoMultipart } = await import(pathToFileURL(join(raiz, 'lib', 'multipart.js')).href);

/** Corpo em JSON para endpoints de formulario e bytes para os de upload. */
function lerCorpoBruto(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 6 * 1024 * 1024) {
        reject(new Error('Corpo grande demais.'));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/** Interpreta multipart/form-data no formato que os handlers esperam. */


const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const caminho = decodeURIComponent(url.pathname);

  if (caminho.startsWith('/api/')) {
    const handler = roteador;
    let body;
    const tipo = req.headers['content-type'] || '';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const bruto = await lerCorpoBruto(req);
      if (tipo.includes('multipart/form-data')) {
        body = corpoMultipart(bruto, tipo);
      } else {
        try { body = JSON.parse(bruto.toString('utf8') || '{}'); } catch { body = bruto; }
      }
    }
    const query = Object.fromEntries(url.searchParams.entries());
    await handler({ method: req.method, url: caminho, query, body, headers: req.headers, cookies: req.headers.cookie }, res);
    return;
  }

  // Arquivos estaticos; sem extensao assume index.html (rotas por hash).
  const relativo = normalize(caminho === '/' ? '/index.html' : caminho).replace(/^([/\\])+/, '');
  const alvo = join(raiz, relativo);
  if (!alvo.startsWith(raiz)) {
    res.writeHead(403).end('Proibido');
    return;
  }
  try {
    const dados = await readFile(alvo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(alvo).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(dados);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nao encontrado');
  }
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nA porta ${porta} já está em uso.`);
    console.error('Ou outro servidor local está no ar, ou sobrou um de uma execução anterior:');
    console.error(`  npx kill-port ${porta}`);
    console.error('Ou rode em outra porta:  PORT=8788 npm run dev:local\n');
    process.exit(1);
  }
  throw e;
});

servidor.listen(porta, '127.0.0.1', () => {
  console.log(`Radar Mecanico em http://127.0.0.1:${porta}`);
  console.log(`Banco: ${descricaoBanco()}`);
});
