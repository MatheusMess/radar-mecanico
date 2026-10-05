import { lerCookie, lerToken } from './auth.js';
import { iniciar, usuarioPublico } from './db.js';

/**
 * Ajudantes de request/response e as guardas de autenticacao.
 *
 * O PHP usava um token CSRF guardado na sessao. Aqui a sessao e um cookie
 * httpOnly SameSite=Lax, entao a defesa e exigir um header customizado
 * (que um site terceiro nao consegue enviar em cross-origin simples) e
 * conferir o Origin.
 */

export function json(dados, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(dados),
  };
}

export function erro(mensagem, status = 422, headers = {}) {
  return json({ error: mensagem }, status, headers);
}

/** Escreve o objeto de resposta na res do Vercel. */
function responder(res, r) {
  res.statusCode = r.statusCode;
  for (const [k, v] of Object.entries(r.headers || {})) {
    if (v) res.setHeader(k, v);
  }
  res.end(r.body);
}

/**
 * Envolve um endpoint: garante que sempre sai JSON, nunca estoura excecao
 * e trata os erros conhecidos do SQLite.
 *
 * uso:  export default rota(async (req, res) => { ... return json({ok:true}) })
 */
export function rota(fn) {
  return async (req, res) => {
    try {
      const r = await fn(req, res);
      responder(res, r || erro('Endpoint sem resposta.', 500));
    } catch (e) {
      const msg = String(e?.message || '');
      if (/UNIQUE constraint failed: users.email/.test(msg)) {
        return responder(res, erro('Este e-mail já está cadastrado.', 422));
      }
      if (/UNIQUE constraint failed/.test(msg)) {
        return responder(res, erro('Este cadastro já existe.', 422));
      }
      if (/FOREIGN KEY constraint failed/.test(msg)) {
        return responder(res, erro('Vínculo inválido com outro registro.', 422));
      }
      if (/CHECK constraint failed/.test(msg)) {
        return responder(res, erro('Valor fora do permitido.', 422));
      }
      if (/no such table/.test(msg)) {
        return responder(res, erro('Banco ainda não inicializado.', 500));
      }
      console.error('[api]', msg);
      responder(res, erro('Não foi possível concluir a operação.', 500));
    }
  };
}

/** Le o corpo JSON. Devolve objeto (vazio se nao houver). */
export async function lerCorpo(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    if (!req.body.trim()) return {};
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
    try { return JSON.parse(Buffer.from(req.body).toString('utf8')); } catch { return {}; }
  }
  return req.body;
}

function metodo(req) {
  return (req.method || 'GET').toUpperCase();
}

/** Remove tags e espacos, como o clean() do PHP. */
export function limpar(valor) {
  return String(valor ?? '').replace(/<[^>]*>/g, '').trim();
}

/** So digitos, como o digits() do PHP. */
export function digitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Seguranca de requisicao
// ---------------------------------------------------------------------------

function origemPermitida(req) {
  const origem = req.headers?.origin;
  if (!origem) return true; // clientes sem Origin (curl, seed) nao sao bloqueados
  const host = req.headers?.host;
  if (!host) return true;
  try {
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}

/**
 * Protecao contra CSRF. Exige:
 *  - Origin (quando enviado) da mesma origem;
 *  - header X-Requested-With, que um <form> de outro site nao consegue mandar.
 */
export function csrfOk(req) {
  if (metodo(req) === 'GET' || metodo(req) === 'HEAD') return true;
  if (!origemPermitida(req)) return false;
  return req.headers?.['x-requested-with'] === 'radar';
}

// ---------------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------------

export async function usuarioAtual(req) {
  await iniciar();
  const uid = lerToken(lerCookie(req, 'sessao'));
  if (!uid) return null;
  const u = await usuarioPublico(uid);
  if (!u) return null;
  return { ...u, is_blocked: Number(u.is_blocked) };
}

export async function comSessao(req) {
  const u = await usuarioAtual(req);
  if (!u) return { res: erro('Sessão expirada.', 401) };
  if (Number(u.is_blocked) === 1) {
    return { res: erro('Esta conta está bloqueada.', 403) };
  }
  return { u };
}