import { json, erro, rota, csrfOk } from '../lib/http.js';
import { cookieLimpar } from '../lib/auth.js';

/** Encerra a sessao limpando o cookie. */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieLimpar() });
});