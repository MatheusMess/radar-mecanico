import { json, erro, rota, lerCorpo, csrfOk } from '../lib/http.js';
import { iniciar, one } from '../lib/db.js';
import { verificarSenha, criarToken, cookieSessao } from '../lib/auth.js';

/** Login por e-mail e senha. */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  await iniciar();
  const d = await lerCorpo(req);
  const email = String(d.email ?? '').trim().toLowerCase();
  const senha = String(d.password ?? '');
  if (!email || !senha) return erro('Informe e-mail e senha.', 422);

  const u = await one('SELECT * FROM users WHERE email = ?', [email]);
  if (!u || !verificarSenha(senha, u.password_hash)) {
    return erro('E-mail ou senha inválidos.', 422);
  }
  if (Number(u.is_blocked) === 1) return erro('Esta conta está bloqueada.', 403);

  return json({ user: publicUser(u) }, 200, {
    'Set-Cookie': cookieSessao(criarToken(u.id)),
  });
});

/** Payload do usuario sem os campos sensiveis. */
export function publicUser(u) {
  return {
    id: Number(u.id),
    role: u.role,
    name: u.name,
    email: u.email,
    cpf: u.cpf ?? null,
    phone: u.phone,
    is_blocked: Number(u.is_blocked ?? 0),
  };
}