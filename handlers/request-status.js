import { json, erro, rota, lerCorpo, csrfOk, comSessao } from '../lib/http.js';
import { one, run, REQUEST_STATUS, requestStatusLabel } from '../lib/db.js';

/**
 * Muda o status do pedido (RF11).
 * A oficina conduz o servico; o cliente so pode cancelar antes do aceite.
 */
const PERMITIDAS = {
  oficina: {
    // De "aberto" só a recusa: um serviço não pode ser concluído sem orçamento.
    open: ['cancelled'],
    responded: ['in_progress', 'completed', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  cliente: {
    open: ['cancelled'],
    responded: ['cancelled'],
    in_progress: [],
    completed: [],
    cancelled: [],
  },
};

export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  const d = await lerCorpo(req);
  const id = Number(d.request_id ?? 0);
  const novo = String(d.status ?? '');
  if (!REQUEST_STATUS.includes(novo)) return erro('Status inválido.', 422);

  const r = await one(
    `SELECT r.id, r.status, r.client_id, w.user_id workshop_user
       FROM requests r JOIN workshops w ON w.id = r.workshop_id WHERE r.id = ?`,
    [id]
  );
  if (!r) return erro('Pedido não encontrado.', 404);

  const ehOficina = Number(r.workshop_user) === Number(u.id);
  if (!ehOficina && Number(r.client_id) !== Number(u.id)) {
    return erro('Acesso restrito a este pedido.', 403);
  }

  const atual = String(r.status);
  const permitidas = (ehOficina ? PERMITIDAS.oficina : PERMITIDAS.cliente)[atual] ?? [];
  if (!permitidas.includes(novo)) {
    const quem = ehOficina ? 'A oficina não pode' : 'Você não pode';
    return erro(`${quem} mudar de "${requestStatusLabel(atual)}" para "${requestStatusLabel(novo)}".`, 422);
  }

  await run('UPDATE requests SET status = ? WHERE id = ?', [novo, id]);
  return json({ ok: true, status: novo, label: requestStatusLabel(novo) });
});