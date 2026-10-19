import { json, erro, rota, lerCorpo, csrfOk, comSessao } from '../lib/http.js';
import { one, run } from '../lib/db.js';

/**
 * Exclui um veiculo do cliente logado. As fotos somem por cascade na tabela
 * vehicle_images (e os BLOB junto, ja que nao ha arquivos no disco).
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  if (sessao.u.role !== 'client') return erro('Apenas Clientes podem excluir veículos.', 403);

  const d = await lerCorpo(req);
  const id = Number(d.vehicle_id ?? req.query?.vehicle_id ?? 0);
  const dono = await one('SELECT id FROM vehicles WHERE id = ? AND client_id = ?', [id, sessao.u.id]);
  if (!dono) return erro('Veículo não encontrado.', 404);

  await run('DELETE FROM vehicles WHERE id = ? AND client_id = ?', [id, sessao.u.id]);
  return json({ ok: true });
});