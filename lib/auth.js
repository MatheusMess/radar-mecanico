import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

/**
 * Senhas com scrypt e cookie de sessao assinado com HMAC.
 *
 * O PHP guardava a sessao em storage/sessions. No Vercel (serverless, disco
 * somente leitura) isso nao funciona, entao a sessao vira um cookie httpOnly
 * assinado: id do usuario + validade + assinatura. Sem estado no servidor.
 */

const CUSTO_SCRYPT = 16384; // ~N que o Node aceita (16384 e o minimo seguro aqui)
const TAM_CHAVE = 64;

// ---------------------------------------------------------------------------
// Senhas
// ---------------------------------------------------------------------------

/** Formato: scrypt$<custo>$<sal hex>$<hash hex> */
export function hashSenha(senha) {
  const sal = randomBytes(16);
  const chave = scryptSync(String(senha), sal, TAM_CHAVE, { N: CUSTO_SCRYPT });
  return `scrypt$${CUSTO_SCRYPT}$${sal.toString('hex')}$${chave.toString('hex')}`;
}

export function verificarSenha(senha, guardado) {
  try {
    const [algo, custo, salHex, hashHex] = String(guardado).split('$');
    if (algo !== 'scrypt') return false;
    const esperado = Buffer.from(hashHex, 'hex');
    const obtido = scryptSync(String(senha), Buffer.from(salHex, 'hex'), esperado.length, {
      N: Number(custo),
    });
    return timingSafeEqual(esperado, obtido);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sessao
// ---------------------------------------------------------------------------
const VALIDADE_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET ausente ou muito curto. Defina no .env.local ou nas variaveis da Vercel.');
  }
  return s;
}

function assinar(dados) {
  return createHmac('sha256', segredo()).update(dados).digest('base64url');
}

/** Gera o valor do cookie: base64url(payload).assinatura */
export function criarToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: Number(userId), exp: Date.now() + VALIDADE_MS })
  ).toString('base64url');
  return `${payload}.${assinar(payload)}`;
}

/** Valida assinatura e validade. Devolve o userId ou null. */
export function lerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return null;
  let esperada;
  try {
    esperada = assinar(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!dados?.uid || !dados?.exp || Date.now() > dados.exp) return null;
    return dados.uid;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

export function lerCookie(req, nome) {
  const bruto = req.headers?.cookie || '';
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieSessao(token, maxAgeSegundos = VALIDADE_MS / 1000) {
  const partes = [
    `sessao=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSegundos}`,
  ];
  if (process.env.NODE_ENV === 'production') partes.push('Secure');
  return partes.join('; ');
}

export function cookieLimpar() {
  const partes = ['sessao=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') partes.push('Secure');
  return partes.join('; ');
}