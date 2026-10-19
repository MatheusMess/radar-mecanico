import {
  json, erro, rota, lerCorpo, limpar, csrfOk, comSessao,
} from '../lib/http.js';
import {
  all, one, run, placaValida, placaKey, anoValido, anoLimites,
  chassiValido, chassiKey, COMBUSTIVEIS,
} from '../lib/db.js';

/**
 * Garagem do cliente.
 *   GET  -> veiculos com contagem de fotos
 *   POST -> cadastra (id ausente) ou edita (id presente)
 *
 * Todos os campos sao obrigatorios: marca, modelo, ano, placa, cor,
 * combustivel e quilometragem.
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  const metodo = (req.method || 'GET').toUpperCase();
  if (metodo === 'GET') {
    const veiculos = await all(
      `SELECT v.*,
              (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id) image_count,
              -- O card da garagem usa a primeira foto como miniatura.
              (SELECT i.id FROM vehicle_images i WHERE i.vehicle_id = v.id ORDER BY i.id LIMIT 1) image_id
         FROM vehicles v WHERE v.client_id = ? ORDER BY v.id DESC`,
      [u.id]
    );
    return json({ vehicles: veiculos.map(serializar) });
  }

  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  if (u.role !== 'client') return erro('Apenas Clientes podem cadastrar veículos.', 403);

  const d = await lerCorpo(req);
  const id = Number(d.id ?? 0);
  if (id > 0) {
    const dono = await one('SELECT id FROM vehicles WHERE id = ? AND client_id = ?', [id, u.id]);
    if (!dono) return erro('Veículo não encontrado.', 404);
  }

  const marca = limpar(d.brand);
  const modelo = limpar(d.model);
  const cor = limpar(d.color);
  const placa = placaKey(d.plate);
  const anoTxt = String(d.year ?? '').trim();
  const ano = Number(anoTxt);
  const kmTxt = String(d.mileage ?? '').trim();
  const combustivel = limpar(d.fuel);
  const [minAno, maxAno] = anoLimites();

  const faltando = !marca ? 'a marca' : !modelo ? 'o modelo' : !cor ? 'a cor' : '';
  if (faltando) return erro(`Informe ${faltando} do veículo.`, 422);

  if (anoTxt === '') return erro('Informe o ano com 4 dígitos.', 422);
  if (!/^\d{4}$/.test(anoTxt)) return erro('Informe o ano com 4 dígitos.', 422);
  if (!anoValido(anoTxt)) return erro(`Ano inválido. Informe um ano entre ${minAno} e ${maxAno}.`, 422);

  if (placa === '') return erro('A placa do veículo é obrigatória.', 422);
  if (!placaValida(placa)) return erro('Placa inválida. Use o padrão ABC1D23 ou ABC1234.', 422);

  if (!COMBUSTIVEIS.includes(combustivel)) return erro('Selecione o combustível do veículo.', 422);
  if (kmTxt === '' || !/^\d+$/.test(kmTxt)) return erro('Informe a quilometragem atual em km.', 422);

  const dup = await one('SELECT id FROM vehicles WHERE plate = ? AND client_id = ? AND id <> ?', [placa, u.id, id]);
  if (dup) return erro('Você já cadastrou um veículo com esta placa.', 422);

  // Chassi e opcional, mas se vier precisa ser um chassi de verdade.
  const chassi = chassiKey(d.chassi);
  if (chassi && !chassiValido(chassi)) {
    return erro('Chassi inválido. São 17 caracteres, sem as letras I, O e Q.', 422);
  }
  const outroChassi = chassi
    ? await one('SELECT id FROM vehicles WHERE chassi = ? AND client_id = ? AND id <> ?', [chassi, u.id, id])
    : null;
  if (outroChassi) return erro('Você já cadastrou um veículo com este chassi.', 422);

  const makeModel = `${marca} ${modelo}`;
  const km = Number(kmTxt);
  const notas = limpar(d.notes);

  if (id > 0) {
    await run(
      `UPDATE vehicles SET make_model = ?, plate = ?, year = ?, brand = ?, model = ?, color = ?, fuel = ?, mileage = ?, notes = ?, chassi = ?
        WHERE id = ? AND client_id = ?`,
      [makeModel, placa, ano, marca, modelo, cor, combustivel, km, notas, chassi, id, u.id]
    );
    return json({ ok: true, vehicle_id: id });
  }

  const { lastInsertId } = await run(
    `INSERT INTO vehicles(client_id,make_model,plate,year,brand,model,color,fuel,mileage,notes,chassi)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [u.id, makeModel, placa, ano, marca, modelo, cor, combustivel, km, notas, chassi]
  );
  return json({ ok: true, vehicle_id: Number(lastInsertId) });
});

function serializar(v) {
  return {
    id: Number(v.id),
    make_model: v.make_model,
    brand: v.brand,
    model: v.model,
    plate: v.plate,
    year: v.year,
    color: v.color,
    fuel: v.fuel,
    mileage: v.mileage,
    notes: v.notes ?? '',
    chassi: v.chassi ?? '',
    image_count: Number(v.image_count ?? 0),
    image_id: v.image_id === null || v.image_id === undefined ? null : Number(v.image_id),
  };
}