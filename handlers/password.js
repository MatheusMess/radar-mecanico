import { json, erro, rota, lerCorpo, csrfOk, comSessao } from '../lib/http.js';
import { one, run } from '../lib/db.js';
import { hashSenha, verificarSenha } from '../lib/auth.js';

/**
 * Troca de senha. Exige a senha atual, o que evita que um cookie vazado
 * vire troca de credencial sem conhecimento da senha antiga.
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  const d = await lerCorpo(req);
  const atual = String(d.current_password ?? '');
  const nova = String(d.new_password ?? '');
  if (nova.length < 8) return erro('A nova senha deve ter ao menos 8 caracteres.', 422);
  if (nova === atual) return erro('A nova senha deve ser diferente da atual.', 422);

  const guardado = await one('SELECT password_hash FROM users WHERE id = ?', [u.id]);
  if (!guardado || !verificarSenha(atual, guardado.password_hash)) {
    return erro('Senha atual incorreta.', 422);
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashSenha(nova), u.id]);
  return json({ ok: true });
});