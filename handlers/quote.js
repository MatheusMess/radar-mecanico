import { json, erro, rota, lerCorpo, limpar, csrfOk, comSessao } from '../lib/http.js';
import { one, run, requestStatusLabel } from '../lib/db.js';

/**
 * A oficina responde com um orcamento (RF10). Isso move o pedido para
 * "Orçamento enviado". Pedidos concluidos ou cancelados nao aceitam resposta.
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  if (sessao.u.role !== 'workshop') return erro('Apenas Oficinas podem responder.', 403);

  const d = await lerCorpo(req);
  const id = Number(d.request_id ?? 0);
  const r = await one(
    `SELECT r.id, r.status FROM requests r
       JOIN workshops w ON w.id = r.workshop_id
      WHERE r.id = ? AND w.user_id = ?`,
    [id, sessao.u.id]
  );
  if (!r) return erro('Pedido não encontrado.', 404);
  if (['completed', 'cancelled'].includes(String(r.status))) {
    return erro(`Não é possível responder um pedido ${requestStatusLabel(String(r.status))}.`, 422);
  }

  const min = Number(d.amount_min ?? 0);
  const max = Number(d.amount_max ?? 0);
  if (!(min >= 0) || !(max >= 0) || min > max) {
    return erro('Informe um intervalo de valores válido (mínimo e máximo).', 422);
  }
  const mensagem = limpar(d.message);
  if (!mensagem) return erro('Escreva a mensagem para o cliente.', 422);

  const jaExiste = await one('SELECT id FROM quotes WHERE request_id = ?', [id]);
  if (jaExiste) {
    await run(
      'UPDATE quotes SET message = ?, amount_min = ?, amount_max = ? WHERE request_id = ?',
      [mensagem, min, max, id]
    );
  } else {
    await run('INSERT INTO quotes(request_id,message,amount_min,amount_max) VALUES(?,?,?,?)', [id, mensagem, min, max]);
  }
  // Responder move "aberto" para "respondido", mas não regride um serviço que
  // a oficina já aceitou (senão o botão voltaria a dizer "Aceitar").
  if (String(r.status) === 'open') {
    await run("UPDATE requests SET status = 'responded' WHERE id = ?", [id]);
  }
  return json({ ok: true, status: String(r.status), label: requestStatusLabel(String(r.status)) });
});