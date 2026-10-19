import {
  json, erro, rota, lerCorpo, limpar, csrfOk, comSessao,
} from '../lib/http.js';
import { run, listaEspecialidades } from '../lib/db.js';

/**
 * Catalogo de especialidades (RF05).
 *   GET                      -> lista para o formulario da oficina
 *   POST operation=create    -> cria uma especialidade nova
 *
 * O vinculo com a oficina fica em esp_ofc e e gerenciado por
 * api/profile.js (operation=especialidades). Aqui so o catalogo, para nao
 * duplicar regra de permissao.
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;

  if ((req.method || 'GET').toUpperCase() === 'GET') {
    const lista = await listaEspecialidades();
    return json({
      especialidades: lista.map((e) => ({
        id: Number(e.id),
        nome: e.nome,
        descricao: e.descricao ?? '',
        workshop_count: Number(e.workshop_count ?? 0),
      })),
    });
  }

  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  if (sessao.u.role !== 'admin') return erro('Somente o administrador cria especialidades.', 403);

  const d = await lerCorpo(req);
  if (String(d.operation ?? 'create') !== 'create') return erro('Operação inválida.', 422);

  const nome = limpar(d.nome);
  const descricao = limpar(d.descricao);
  if (!nome) return erro('Informe o nome da especialidade.', 422);

  try {
    const { lastInsertId } = await run(
      'INSERT INTO especialidades(nome,descricao) VALUES(?,?)',
      [nome, descricao]
    );
    return json({ ok: true, id: Number(lastInsertId) });
  } catch (e) {
    if (/UNIQUE constraint failed/.test(String(e.message))) {
      return erro('Já existe uma especialidade com este nome.', 422);
    }
    throw e;
  }
});
