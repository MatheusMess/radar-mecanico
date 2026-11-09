import * as pg from './pg.js';

/**
 * Acesso ao banco (Postgres, via Supabase em producao).
 *
 * Todas as consultas do projeto passam por aqui. O dialeto e Postgres:
 * placeholders numerados ($1, $2...), RETURNING id para pegar o id gerado e
 * ON CONFLICT DO NOTHING no lugar de INSERT OR IGNORE.
 *
 * As datas continuam guardadas como texto no formato 'AAAA-MM-DD HH:MM:SS'
 * (o mesmo que o SQLite usava), porque o frontend exibe created_at como veio e
 * esse formato ordena igual a data.
 */
export const FORMATO_DATA = "to_char(now(), 'YYYY-MM-DD HH24:MI:SS')";

/** Executa e devolve as linhas. */
export async function all(sql, args = []) {
  return (await pg.query(sql, args)).rows;
}

/** Executa e devolve a primeira linha, ou null. */
export async function one(sql, args = []) {
  const { rows } = await pg.query(sql, args);
  return rows.length ? rows[0] : null;
}

/**
 * Executa INSERT/UPDATE/DELETE.
 *
 * lastInsertId so vem preenchido quando a consulta termina em RETURNING id;
 * e assim que o Postgres informa o id gerado (nao existe lastInsertRowid).
 */
export async function run(sql, args = []) {
  const r = await pg.query(sql, args);
  return {
    changes: r.rowCount,
    lastInsertId: Number(r.rows?.[0]?.id ?? 0),
  };
}

/** Executa varios comandos em uma transacao: ou todos entram, ou nenhum. */
export async function batch(statements) {
  if (!statements.length) return [];
  return pg.transacao(async (tx) => {
    const saida = [];
    for (const s of statements) {
      const r = await tx.query(s.sql, s.args ?? []);
      saida.push({ changes: r.rowCount, lastInsertId: Number(r.rows?.[0]?.id ?? 0) });
    }
    return saida;
  });
}

/** Banco em uso, para logs e para a pagina inicial dos scripts. */
export function descricaoBanco() {
  return pg.descreverBanco();
}

/** Fecha o pool; os scripts chamam no fim. */
export const fechar = pg.fechar;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('client','workshop','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  cpf TEXT,
  phone TEXT NOT NULL,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA}
);

CREATE TABLE IF NOT EXISTS workshops (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  cnpj TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT,
  services TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT 'Seg–Sex, 08:00–18:00',
  rating DOUBLE PRECISION NOT NULL DEFAULT 5,
  photo BYTEA,
  photo_mime TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  make_model TEXT NOT NULL,
  plate TEXT NOT NULL,
  year INTEGER,
  brand TEXT,
  model TEXT,
  color TEXT,
  fuel TEXT,
  mileage INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA},
  FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicle_images (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/png',
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA},
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  workshop_id INTEGER NOT NULL,
  vehicle_id INTEGER,
  service_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA},
  FOREIGN KEY(client_id) REFERENCES users(id),
  FOREIGN KEY(workshop_id) REFERENCES workshops(id),
  -- SET NULL: o cliente pode excluir um veiculo mesmo com pedidos antigos
  -- apontando para ele. Sem isso o DELETE falharia por FK e o veiculo ficaria
  -- impossivel de remover da garagem.
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS request_images (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/png',
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA},
  FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE,
  message TEXT NOT NULL,
  amount_min DOUBLE PRECISION,
  amount_max DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA},
  FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  request_id INTEGER NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT ${FORMATO_DATA},
  FOREIGN KEY(workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vehicles_client ON vehicles(client_id);

-- Endereco e uma tabela de verdade: antes, o endereco era texto solto dentro
-- de users/workshops, o que impedia rua/numero/bairro/cep separados.
CREATE TABLE IF NOT EXISTS enderecos (
  id SERIAL PRIMARY KEY,
  cep TEXT NOT NULL DEFAULT '',
  cidade TEXT NOT NULL DEFAULT '',
  rua TEXT NOT NULL DEFAULT '',
  numero INTEGER,
  bairro TEXT NOT NULL DEFAULT '',
  complemento TEXT NOT NULL DEFAULT ''
);

-- Um cliente pode ter varios enderecos (casa, trabalho).
CREATE TABLE IF NOT EXISTS endereco_cliente (
  cliente_id INTEGER NOT NULL,
  endereco_id INTEGER NOT NULL,
  PRIMARY KEY(cliente_id, endereco_id),
  FOREIGN KEY(cliente_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(endereco_id) REFERENCES enderecos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS especialidades (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL DEFAULT ''
);

-- N:N entre oficina e especialidade.
CREATE TABLE IF NOT EXISTS esp_ofc (
  oficina_id INTEGER NOT NULL,
  especialidade_id INTEGER NOT NULL,
  PRIMARY KEY(oficina_id, especialidade_id),
  FOREIGN KEY(oficina_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY(especialidade_id) REFERENCES especialidades(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_endereco_cliente ON endereco_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_esp_ofc ON esp_ofc(oficina_id);
CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_workshop ON requests(workshop_id);
CREATE INDEX IF NOT EXISTS idx_reviews_workshop ON reviews(workshop_id);
CREATE INDEX IF NOT EXISTS idx_vimages_vehicle ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rimages_request ON request_images(request_id);
`;

/**
 * Colunas que entraram depois da primeira versao do schema.
 *
 * `CREATE TABLE IF NOT EXISTS` nao acrescenta coluna em tabela que ja existe,
 * entao quem foi criado antes precisa de ALTER TABLE. `ADD COLUMN IF NOT
 * EXISTS` torna a migracao repetivel: rodar a cada requisicao nao muda nada.
 *
 * O desenho de banco tambem pedia `requests.data_hora_criacao`: aqui a coluna
 * se chama `created_at` e cumpre o mesmo papel, com o mesmo formato.
 */
const COLUNAS_NOVAS = [
  ['vehicles', 'chassi', "TEXT NOT NULL DEFAULT ''"],
  ['workshops', 'garagem', 'INTEGER NOT NULL DEFAULT 0'],
  // Contador de versao da foto. A URL /api/image precisa mudar quando a foto
  // muda, senao o navegador serve a imagem antiga do cache (24 h) e o dono
  // nunca ve o resultado do upload.
  ['workshops', 'photo_rev', 'INTEGER NOT NULL DEFAULT 0'],
  ['requests', 'detalhes', "TEXT NOT NULL DEFAULT ''"],
];

let _pronto = null;

/**
 * Cria o schema se ainda nao existir e acrescenta colunas novas.
 *
 * O schema tambem esta em supabase/schema.sql, para quem preferir rodar uma
 * vez no SQL Editor do Supabase. Rodar as duas coisas e inofensivo: tudo aqui
 * e IF NOT EXISTS.
 */
export function iniciar() {
  if (_pronto) return _pronto;
  _pronto = (async () => {
    try {
      await pg.exec(SCHEMA);
    } catch (e) {
      // Duas instancias subindo ao mesmo tempo podem disputar a criacao de um
      // objeto. Nesse caso, o schema ja esta la.
      if (!/already exists|duplicate key value/i.test(String(e?.message))) throw e;
    }
    for (const [tabela, coluna, tipo] of COLUNAS_NOVAS) {
      await pg.exec(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS ${coluna} ${tipo}`);
    }
    await limparVeiculosInvalidos();
  })();
  _pronto.catch(() => { _pronto = null; });
  return _pronto;
}

export function anoLimites() {
  return [1886, new Date().getFullYear() + 1];
}

/** Placa brasileira: Mercosul (ABC1D23) ou anterior (ABC1234). */
export function placaValida(valor) {
  const p = String(valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}(?:[0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(p);
}
export function placaKey(valor) {
  return String(valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function anoValido(ano) {
  const [min, max] = anoLimites();
  return /^\d{4}$/.test(String(ano)) && Number(ano) >= min && Number(ano) <= max;
}

/**
 * Chassi: 17 caracteres, sem I/O/Q (para nao confundir com 1 e 0).
 * Aceita o numero tambem com pontuacao de documento; a chave guardada e limpa.
 */
export function chassiValido(valor) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(chassiKey(valor));
}
export function chassiKey(valor) {
  return String(valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** CEP: 8 digitos, guardado so o numero. */
export function cepKey(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}
export function cepValido(valor) {
  return /^\d{8}$/.test(cepKey(valor));
}

async function limparVeiculosInvalidos() {
  const rows = await all('SELECT id, plate, year FROM vehicles');
  const ids = rows
    .filter((r) => !anoValido(r.year) || !placaValida(r.plate))
    .map((r) => r.id);
  if (!ids.length) return 0;
  const marcadores = ids.map((_, i) => `$${i + 1}`).join(',');
  await run(`DELETE FROM vehicles WHERE id IN (${marcadores})`, ids);
  return ids.length;
}

// ---------------------------------------------------------------------------
// Dominio
// ---------------------------------------------------------------------------
export const REQUEST_STATUS = ['open', 'responded', 'in_progress', 'completed', 'cancelled'];

export function requestStatusLabel(s) {
  return {
    open: 'Solicitado',
    responded: 'Orçamento enviado',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  }[s] || s;
}

/** Mantem workshops.rating igual a media real das avaliacoes. */
export async function syncWorkshopRating(workshopId) {
  const r = await one('SELECT count(*) n, avg(rating) avg FROM reviews WHERE workshop_id = $1', [workshopId]);
  const media = Number(r.n) > 0 ? Math.round(Number(r.avg) * 100) / 100 : 5;
  await run('UPDATE workshops SET rating = $1 WHERE id = $2', [media, workshopId]);
}

export const COMBUSTIVEIS = ['Gasolina', 'Etanol', 'Flex', 'Diesel', 'Elétrico', 'Híbrido'];

/** Especialidades cadastradas, em ordem alfabetica. */
export async function listaEspecialidades() {
  return all(
    `SELECT e.id, e.nome, e.descricao,
            (SELECT count(*) FROM esp_ofc o WHERE o.especialidade_id = e.id) workshop_count
       FROM especialidades e ORDER BY e.nome`
  );
}

/**
 * Nomes das especialidades de varias oficinas em uma consulta so.
 * Um SELECT por oficina seria N+1, e a listagem cresce com a rede.
 */
export async function mapaEspecialidades(ids) {
  if (!ids.length) return new Map();
  const marcadores = ids.map((_, i) => `$${i + 1}`).join(',');
  const linhas = await all(
    `SELECT o.oficina_id, e.nome FROM esp_ofc o
       JOIN especialidades e ON e.id = o.especialidade_id
      WHERE o.oficina_id IN (${marcadores})
      ORDER BY e.nome`,
    ids
  );
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(Number(l.oficina_id))) mapa.set(Number(l.oficina_id), []);
    mapa.get(Number(l.oficina_id)).push(l.nome);
  }
  return mapa;
}

/** Especialidades de uma oficina. */
export async function especialidadesDaOficina(workshopId) {
  return all(
    `SELECT e.id, e.nome, e.descricao
       FROM esp_ofc o JOIN especialidades e ON e.id = o.especialidade_id
      WHERE o.oficina_id = $1 ORDER BY e.nome`,
    [workshopId]
  );
}

/**
 * Substitui o conjunto de especialidades da oficina. Vai num passo so porque
 * o N:N nao tem estado proprio: apagar e reinserir e mais simples do que
 * fazer diff, e o conjunto costuma ser pequeno.
 */
export async function defineEspecialidades(workshopId, ids) {
  const unicos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  await run('DELETE FROM esp_ofc WHERE oficina_id = $1', [workshopId]);
  if (unicos.length) {
    await batch(unicos.map((id) => ({
      sql: `INSERT INTO esp_ofc(oficina_id, especialidade_id) VALUES($1, $2)
            ON CONFLICT DO NOTHING`,
      args: [workshopId, id],
    })));
  }
  return unicos.length;
}

/** Enderecos de um cliente. */
export async function enderecosDoCliente(clienteId) {
  return all(
    `SELECT e.id, e.cep, e.cidade, e.rua, e.numero, e.bairro, e.complemento
       FROM endereco_cliente ec JOIN enderecos e ON e.id = ec.endereco_id
      WHERE ec.cliente_id = $1 ORDER BY e.id`,
    [clienteId]
  );
}

/**
 * Cria (ou reaproveita) um endereco e o liga ao cliente.
 * Enderecos iguais viram o mesmo registro: dois clientes na mesma rua e numero
 * nao devem duplicar a linha.
 */
export async function gravaEnderecoDoCliente(clienteId, dados) {
  const cep = cepKey(dados.cep);
  const cidade = String(dados.cidade ?? '').trim();
  const rua = String(dados.rua ?? '').trim();
  const bairro = String(dados.bairro ?? '').trim();
  const complemento = String(dados.complemento ?? '').trim();
  const numeroTxt = String(dados.numero ?? '').trim();
  if (!cidade || !rua) throw new Error('Informe cidade e rua.');
  const numero = numeroTxt === '' ? null : Number(numeroTxt);
  if (numero !== null && !Number.isInteger(numero)) {
    throw new Error('Número do endereço deve ser um número inteiro.');
  }

  // IS NOT DISTINCT FROM compara NULL com NULL como igual, que e o que a
  // busca por endereco repetido precisa (numero e complemento podem ser null).
  const igual = await one(
    `SELECT id FROM enderecos
      WHERE cep = $1 AND cidade = $2 AND rua = $3
        AND numero IS NOT DISTINCT FROM $4
        AND bairro = $5 AND complemento = $6`,
    [cep, cidade, rua, numero, bairro, complemento]
  );
  const enderecoId = igual
    ? Number(igual.id)
    : Number((await run(
        `INSERT INTO enderecos(cep,cidade,rua,numero,bairro,complemento)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [cep, cidade, rua, numero, bairro, complemento]
      )).lastInsertId);

  await run(
    `INSERT INTO endereco_cliente(cliente_id, endereco_id) VALUES($1, $2)
     ON CONFLICT DO NOTHING`,
    [clienteId, enderecoId]
  );
  return enderecoId;
}

/** Tira o vinculo; o endereco some junto se ninguem mais usar. */
export async function removeEnderecoDoCliente(clienteId, enderecoId) {
  await run(
    'DELETE FROM endereco_cliente WHERE cliente_id = $1 AND endereco_id = $2',
    [clienteId, enderecoId]
  );
  const resto = await one('SELECT count(*) n FROM endereco_cliente WHERE endereco_id = $1', [enderecoId]);
  if (Number(resto.n) === 0) await run('DELETE FROM enderecos WHERE id = $1', [enderecoId]);
  return enderecoId;
}

export async function usuarioPublico(id) {
  return one(
    'SELECT id, role, name, email, cpf, phone, is_blocked FROM users WHERE id = $1',
    [id]
  );
}

/** Cria o administrador inicial na primeira execucao. */
export async function garantirAdmin() {
  const jaExiste = await one('SELECT id FROM users WHERE email = $1', ['admin@radarmecanico.local']);
  if (jaExiste) return null;
  const { hashSenha } = await import('./auth.js');
  await run(
    'INSERT INTO users(role,name,email,password_hash,phone) VALUES($1,$2,$3,$4,$5)',
    ['admin', 'Administrador Radar', 'admin@radarmecanico.local',
      await hashSenha('RadarAdm@2026'), '(11) 00000-0000']
  );
  return true;
}
