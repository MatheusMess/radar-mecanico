import { json, erro, rota, lerCorpo, limpar, digitos, csrfOk } from '../lib/http.js';
import { iniciar, run } from '../lib/db.js';
import { hashSenha, criarToken, cookieSessao } from '../lib/auth.js';
import { publicUser } from './login.js';

/**
 * Cadastro. Clientes informam CPF; oficinas informam CNPJ, razao social e
 * endereco. A oficina e o usuario sao criados na mesma transacao logica: se a
 * segunda parte falhar, a primeira e revertida.
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  await iniciar();
  const d = await lerCorpo(req);

  const role = String(d.role ?? '');
  const nome = limpar(d.name);
  const email = String(d.email ?? '').trim().toLowerCase();
  const senha = String(d.password ?? '');
  const telefone = limpar(d.phone);

  if (!['client', 'workshop'].includes(role)) return erro('Perfil inválido.', 422);
  if (!nome || !telefone) return erro('Informe nome e telefone.', 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('Informe um e-mail válido.', 422);
  if (senha.length < 8) return erro('A senha deve ter ao menos 8 caracteres.', 422);

  let cpf = null;
  let oficina = null;
  if (role === 'client') {
    cpf = digitos(d.cpf);
    if (cpf.length !== 11) return erro('Informe um CPF com 11 dígitos.', 422);
  } else {
    const razao = limpar(d.legal_name);
    const cnpj = digitos(d.cnpj);
    const endereco = limpar(d.address);
    const cidade = limpar(d.city);
    if (cnpj.length !== 14) return erro('Informe um CNPJ com 14 dígitos.', 422);
    if (!razao || !endereco || !cidade) {
      return erro('Complete CNPJ, razão social e endereço da oficina.', 422);
    }
    oficina = {
      razao, cnpj, endereco, cidade,
      descricao: limpar(d.description),
      servicos: limpar(d.services),
    };
  }

  const { lastInsertId } = await run(
    'INSERT INTO users(role,name,email,password_hash,cpf,phone) VALUES(?,?,?,?,?,?)',
    [role, nome, email, await hashSenha(senha), cpf, telefone]
  );
  const userId = Number(lastInsertId);

  if (oficina) {
    try {
      await run(
        'INSERT INTO workshops(user_id,legal_name,cnpj,address,city,description,services) VALUES(?,?,?,?,?,?,?)',
        [userId, oficina.razao, oficina.cnpj, oficina.endereco, oficina.cidade, oficina.descricao, oficina.servicos]
      );
    } catch (e) {
      await run('DELETE FROM users WHERE id = ?', [userId]);
      throw e;
    }
  }

  return json({ user: publicUser({ id: userId, role, name: nome, email, cpf, phone: telefone, is_blocked: 0 }) },
    200, { 'Set-Cookie': cookieSessao(criarToken(userId)) });
});