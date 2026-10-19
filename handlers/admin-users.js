import {
  json, erro, rota, lerCorpo, limpar, csrfOk, comSessao,
} from '../lib/http.js';
import { all, run } from '../lib/db.js';
import { hashSenha } from '../lib/auth.js';

/**
 * Central de administracao.
 *   GET  -> lista de contas
 *   POST -> operation = create_admin | toggle_block
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  if (sessao.u.role !== 'admin') return erro('Acesso restrito à administração.', 403);

  if ((req.method || 'GET').toUpperCase() === 'GET') {
    const users = await all(
      'SELECT id, role, name, email, phone, is_blocked, created_at FROM users ORDER BY id DESC'
    );
    return json({
      users: users.map((u) => ({
        id: Number(u.id), role: u.role, name: u.name, email: u.email,
        phone: u.phone, is_blocked: Number(u.is_blocked), created_at: u.created_at,
      })),
    });
  }

  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const d = await lerCorpo(req);
  const operacao = String(d.operation ?? '');

  if (operacao === 'create_admin') {
    const nome = limpar(d.name);
    const email = String(d.email ?? '').trim().toLowerCase();
    const senha = String(d.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('Informe um e-mail válido.', 422);
    if (!nome) return erro('Informe o nome.', 422);
    if (senha.length < 8) return erro('A senha deve ter ao menos 8 caracteres.', 422);
    await run('INSERT INTO users(role,name,email,password_hash,phone) VALUES(?,?,?,?,?)',
      ['admin', nome, email, await hashSenha(senha), limpar(d.phone) || 'Não informado']);
    return json({ ok: true });
  }

  if (operacao === 'toggle_block') {
    const id = Number(d.user_id ?? 0);
    if (id === Number(sessao.u.id)) {
      return erro('O administrador não pode bloquear a própria conta.', 422);
    }
    await run('UPDATE users SET is_blocked = CASE WHEN is_blocked = 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
    return json({ ok: true });
  }

  return erro('Operação administrativa inválida.', 422);
});