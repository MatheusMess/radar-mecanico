import { json, rota, usuarioAtual } from '../lib/http.js';
import { iniciar, garantirAdmin } from '../lib/db.js';

/**
 * Estado da sessao: quem esta logado. Tambem cria o administrador inicial
 * na primeira execucao, porque e este o endpoint que o frontend sempre chama.
 *
 * Uma conta bloqueada e tratada como deslogada: sem isso o cookie antigo
 * ainda abriria a interface e cada acao falharia com 403.
 */
export default rota(async (req) => {
  await iniciar();
  await garantirAdmin();
  const user = await usuarioAtual(req);
  if (user && Number(user.is_blocked) === 1) {
    return json({ user: null, blocked: true }, 403);
  }
  return json({ user });
});