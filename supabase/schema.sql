-- Radar Mecânico — schema do Supabase (Postgres)
--
-- Como usar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Também roda sozinho: a primeira requisição da API chama `iniciar()` em
-- lib/db.js, que aplica exatamente este schema (tudo é IF NOT EXISTS).
--
-- Tipos: os ids são SERIAL, as imagens são BYTEA (o app não usa disco nem
-- bucket, então a foto da oficina, do veículo e do pedido vivem no banco) e
-- created_at é TEXT no formato 'AAAA-MM-DD HH:MM:SS', que é o formato que o
-- frontend exibe e que ordena corretamente.

-- ---------------------------------------------------------------- contas
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('client','workshop','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  cpf TEXT,
  phone TEXT NOT NULL,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------- oficinas
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
  garagem INTEGER NOT NULL DEFAULT 0,
  photo_rev INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- veículos
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
  chassi TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicle_images (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/png',
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- pedidos
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  workshop_id INTEGER NOT NULL,
  vehicle_id INTEGER,
  service_type TEXT NOT NULL,
  description TEXT NOT NULL,
  detalhes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (client_id) REFERENCES users(id),
  FOREIGN KEY (workshop_id) REFERENCES workshops(id),
  -- SET NULL: o cliente pode excluir o veículo sem perder o histórico.
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS request_images (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/png',
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE,
  message TEXT NOT NULL,
  amount_min DOUBLE PRECISION,
  amount_max DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  request_id INTEGER NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- endereços
CREATE TABLE IF NOT EXISTS enderecos (
  id SERIAL PRIMARY KEY,
  cep TEXT NOT NULL DEFAULT '',
  cidade TEXT NOT NULL DEFAULT '',
  rua TEXT NOT NULL DEFAULT '',
  numero INTEGER,
  bairro TEXT NOT NULL DEFAULT '',
  complemento TEXT NOT NULL DEFAULT ''
);

-- Um cliente pode ter vários endereços (casa, trabalho).
CREATE TABLE IF NOT EXISTS endereco_cliente (
  cliente_id INTEGER NOT NULL,
  endereco_id INTEGER NOT NULL,
  PRIMARY KEY (cliente_id, endereco_id),
  FOREIGN KEY (cliente_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (endereco_id) REFERENCES enderecos(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- especialidades
CREATE TABLE IF NOT EXISTS especialidades (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL DEFAULT ''
);

-- N:N entre oficina e especialidade.
CREATE TABLE IF NOT EXISTS esp_ofc (
  oficina_id INTEGER NOT NULL,
  especialidade_id INTEGER NOT NULL,
  PRIMARY KEY (oficina_id, especialidade_id),
  FOREIGN KEY (oficina_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (especialidade_id) REFERENCES especialidades(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- índices
CREATE INDEX IF NOT EXISTS idx_vehicles_client ON vehicles(client_id);
CREATE INDEX IF NOT EXISTS idx_endereco_cliente ON endereco_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_esp_ofc ON esp_ofc(oficina_id);
CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_workshop ON requests(workshop_id);
CREATE INDEX IF NOT EXISTS idx_reviews_workshop ON reviews(workshop_id);
CREATE INDEX IF NOT EXISTS idx_vimages_vehicle ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rimages_request ON request_images(request_id);

-- ---------------------------------------------------------------- migrações
-- Para bancos criados antes destas colunas existirem. Em banco novo elas já
-- vieram nas tabelas acima, então os comandos abaixo não fazem nada.
ALTER TABLE vehicles  ADD COLUMN IF NOT EXISTS chassi     TEXT NOT NULL DEFAULT '';
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS garagem    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS photo_rev  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests  ADD COLUMN IF NOT EXISTS detalhes   TEXT NOT NULL DEFAULT '';
