/**
 * Popula o banco com dados de demonstracao.
 *
 * uso:
 *   npm run seed              apaga e recria os dados demo
 *   node scripts/seed.js --keep  acrescenta sem apagar
 *
 * Sem .env ele popula um SQLite em arquivo na propria pasta, entao da para
 * experimentar sem configurar nada. As imagens sao desenhadas por
 * scripts/desenho.js e guardadas como BLOB (no Vercel nao existe disco
 * gravavel numa funcao serverless).
 */
import { fileURLToPath } from 'node:url';
import { prepararEnvLocal } from './envlocal.js';

prepararEnvLocal(fileURLToPath(new URL('..', import.meta.url)));

const { iniciar, all, one, run, batch, syncWorkshopRating, garantirAdmin, gravaEnderecoDoCliente } =
  await import('../lib/db.js');
const { hashSenha } = await import('../lib/auth.js');
const { Tela, desenharCarro, desenharOficina } = await import('./desenho.js');

const SENHA = 'Demo@2026';
const manter = process.argv.includes('--keep');

const CORES_CARRO = {
  civic: [[200, 205, 212], [120, 40, 38], [70, 95, 120]],
  corolla: [[235, 238, 240], [150, 155, 162], [60, 80, 100]],
  ranger: [[35, 40, 48], [20, 24, 30], [90, 110, 130]],
  onix: [[30, 60, 130], [18, 34, 80], [80, 100, 130]],
  compacto: [[180, 40, 45], [120, 26, 30], [100, 70, 70]],
  utilitario: [[92, 97, 104], [58, 62, 70], [70, 85, 100]],
};

const FUNDOS = [
  [[32, 38, 52], [82, 96, 122]],
  [[46, 42, 38], [120, 108, 92]],
  [[26, 44, 40], [66, 106, 94]],
];

// ---------------------------------------------------------------------------
function bytesDeVeiculo(chave, indice) {
  const [c1, c2, c3] = CORES_CARRO[chave];
  const t = new Tela(560, 360);
  const [f1, f2] = FUNDOS[indice % FUNDOS.length];
  t.gradiente(f1, f2, 0.4 + indice * 0.25);
  desenharCarro(t, indice === 1 ? c2 : c1, c3);
  return Buffer.from(t.paraPng());
}

function bytesDeOficina(cor) {
  const t = new Tela(720, 420);
  t.gradiente([30, 34, 44], [98, 106, 124], 0.35);
  desenharOficina(t, cor, [222, 92, 22]);
  return Buffer.from(t.paraPng());
}

function bytesDoProblema(chave, indice) {
  const [c1, c2, c3] = CORES_CARRO[chave];
  const t = new Tela(560, 360);
  t.gradiente([34, 30, 28], [104, 88, 74], 0.9 - indice * 0.3);
  desenharCarro(t, c2, c3);
  t.retangulo(0, 300, 560, 360, [18, 18, 20]);
  return Buffer.from(t.paraPng());
}

function idUsuario(email) {
  return one('SELECT id FROM users WHERE email = ?', [email]).then((u) => (u ? Number(u.id) : null));
}

async function criarUsuario(role, nome, email, telefone, cpf) {
  const existe = await idUsuario(email);
  if (existe) return existe;
  const { lastInsertId } = await run(
    'INSERT INTO users(role,name,email,password_hash,cpf,phone) VALUES(?,?,?,?,?,?)',
    [role, nome, email, await hashSenha(SENHA), cpf ?? null, telefone]
  );
  return Number(lastInsertId);
}

// ---------------------------------------------------------------------------
async function main() {
  await iniciar();
  await garantirAdmin();

  if (!manter) {
    console.log('Removendo dados de demonstracao anteriores...');
    const antigos = await all("SELECT id FROM users WHERE email LIKE 'demo-%'");
    const ids = antigos.map((u) => Number(u.id));
    if (ids.length) {
      const l = ids.map(() => '?').join(',');
      // A ordem importa: as tabelas filhas sao limpas antes das maes, e a
      // FK de requests -> workshops mantem a limpeza em cascata manual.
      const filhos = [
        ['reviews', `DELETE FROM reviews WHERE client_id IN (${l})`, ids],
        ['request_images', `DELETE FROM request_images WHERE request_id IN (
           SELECT id FROM requests WHERE client_id IN (${l}) OR workshop_id IN (
             SELECT id FROM workshops WHERE user_id IN (${l})))`, ids],
        ['quotes', `DELETE FROM quotes WHERE request_id IN (
           SELECT id FROM requests WHERE client_id IN (${l}) OR workshop_id IN (
             SELECT id FROM workshops WHERE user_id IN (${l})))`, ids],
        ['requests', `DELETE FROM requests WHERE client_id IN (${l}) OR workshop_id IN (
           SELECT id FROM workshops WHERE user_id IN (${l}))`, ids],
        ['vehicle_images', `DELETE FROM vehicle_images WHERE vehicle_id IN (
           SELECT id FROM vehicles WHERE client_id IN (${l}))`, ids],
        ['endereco_cliente', `DELETE FROM endereco_cliente WHERE cliente_id IN (${l})`, ids],
        ['esp_ofc', `DELETE FROM esp_ofc WHERE oficina_id IN (
           SELECT id FROM workshops WHERE user_id IN (${l}))`, ids],
        ['vehicles', `DELETE FROM vehicles WHERE client_id IN (${l})`, ids],
        ['workshops', `DELETE FROM workshops WHERE user_id IN (${l})`, ids],
        ['users', `DELETE FROM users WHERE id IN (${l})`, ids],
      ];
      for (const [rotulo, sql, args] of filhos) {
        const r = await run(sql, args);
        if (r.changes) console.log(`  ${rotulo}: ${r.changes}`);
      }
      console.log(`  ${ids.length} conta(s) removida(s)`);
      // Enderecos que ficaram sem nenhum cliente nao podem sobrar.
      await run('DELETE FROM enderecos WHERE id NOT IN (SELECT endereco_id FROM endereco_cliente)');
    }
  }

  // ------------------------------------------------ catalogo de especialidades
  // RF05: Especialidade + esp_ofc. O catalogo e fixo para o seed nao depender
  // do que ja existir; INSERT OR IGNORE respeita o UNIQUE do nome.
  console.log('\nEspecialidades:');
  const CATALOGO = [
    ['Freios e suspensão', 'Pastilhas, discos, amortecedores, molas, buchas e articulações.'],
    ['Elétrica automotiva', 'Bateria, alternator, motor de partida, chicote e fusíveis.'],
    ['Diagnóstico eletrônico', 'Leitura de falha com osciloscópio, scanner e programação.'],
    ['Injeção eletrônica', 'Limpeza de bicos, calibração e reparo de linha de combustível.'],
    ['Borracharia', 'Montagem, desmontagem, recapagem e pneu novo.'],
    ['Balanceamento e alinhamento', 'Computadorizado, com alinhamento de direção e cambagem.'],
    ['Revisão e manutenção', 'Revisão periódica, troca de óleo e itens de desgaste.'],
    ['Ar-condicionado', 'Carga de gás, regulagem e reparo de sistema.'],
    ['Troca de óleo e filtros', 'Óleo, filtro de óleo, filtro de ar e de cabine.'],
    ['Segurança veicular', 'Freio de estacionamento, faróis, espelhos e vidros.'],
    ['Mecânica geral', 'Motor, câmbio, correias, mangueiras e itens de desgaste.'],
    ['Funilaria e pintura', 'Reparo de amassados, pintura e retorno de fábrica.'],
    ['Turbo e diesel', 'Injetoras, turbo, common rail e sistemas de escapamento.'],
  ];
  for (const [nome, descricao] of CATALOGO) {
    await run('INSERT OR IGNORE INTO especialidades(nome,descricao) VALUES(?,?)', [nome, descricao]);
  }
  const espIds = {};
  for (const e of await all('SELECT id, nome FROM especialidades')) espIds[e.nome] = Number(e.id);

  // ------------------------------------------------------------- oficinas
  console.log('\nOficinas:');
  const oficinas = [
    {
      resp: 'Roberto Prado', email: 'demo-oficina-silva@radar.local', fone: '(11) 99811-2030',
      razao: 'Auto Center Silva LTDA', cnpj: '11222333000181',
      end: 'Rua Domingos de Morais, 1420', cidade: 'São Paulo',
      serv: 'Freios, Suspensão, Alinhamento',
      desc: 'Especialistas em freios e suspensão há 18 anos. Alinhamento e balanceamento computadorizado na própria loja.',
      hor: 'Seg–Sex, 08:00–18:00', cor: [196, 62, 52], garagem: 1,
      esp: ['Freios e suspensão', 'Balanceamento e alinhamento', 'Revisão e manutenção'],
    },
    {
      resp: 'Ana Beatriz Rocha', email: 'demo-oficina-eletrica@radar.local', fone: '(11) 99742-5511',
      razao: 'Auto Elétrica Rocha ME', cnpj: '45987654000162',
      end: 'Av. Brasil, 2870', cidade: 'São Paulo',
      serv: 'Elétrica, Injeção Eletrônica, Diagnóstico',
      desc: 'Diagnóstico eletrônico com osciloscópio. Leitura de falhas, reparo de chicote e programação de injeção.',
      hor: 'Seg–Sex, 09:00–19:00', cor: [188, 200, 216], garagem: 0,
      esp: ['Elétrica automotiva', 'Diagnóstico eletrônico', 'Injeção eletrônica', 'Ar-condicionado'],
    },
    {
      resp: 'Sérgio Tavares', email: 'demo-oficina-pneus@radar.local', fone: '(19) 99630-8899',
      razao: 'Pneus & Rodas Tavares LTDA', cnpj: '33444555000199',
      end: 'Rod. Anhanguera, km 12', cidade: 'Campinas',
      serv: 'Borracharia, Montagem, Balanceamento',
      desc: 'Montagem, desmontagem, recapagem e balanceamento. Atendimento a frotas e veículos de carga.',
      hor: 'Seg–Sáb, 08:00–17:00', cor: [120, 200, 210], garagem: 1,
      esp: ['Borracharia', 'Balanceamento e alinhamento', 'Troca de óleo e filtros', 'Segurança veicular'],
    },
    {
      resp: 'Marta Nunes Prado', email: 'demo-oficina-mecanica@radar.local', fone: '(11) 96422-7788',
      razao: 'Mecânica Geral Prado LTDA', cnpj: '44556677000188',
      end: 'Av. Monteiro Lobato, 345', cidade: 'Guarulhos',
      serv: 'Mecânica geral, Motor, Cambio',
      desc: 'Revisão completa e conserto de motor e câmbio. Oficina de bairro, atende carro e caminhonete.',
      hor: 'Seg–Sex, 08:00–19:00', cor: [220, 170, 90], garagem: 1,
      esp: ['Mecânica geral', 'Revisão e manutenção', 'Freios e suspensão'],
    },
    {
      resp: 'Cleber Andrade Lima', email: 'demo-oficina-diesel@radar.local', fone: '(19) 99210-4455',
      razao: 'Diesel & Turbo Lima ME', cnpj: '55667788000199',
      end: 'Rua das Indústrias, 87', cidade: 'Campinas',
      serv: 'Diesel, Injeção, Turbo',
      desc: 'Especialistas em diesel leve e pesado: injeção, turbo, common rail e escapamento.',
      hor: 'Seg–Sex, 07:30–18:00', cor: [150, 150, 160], garagem: 0,
      esp: ['Turbo e diesel', 'Injeção eletrônica', 'Diagnóstico eletrônico'],
    },
    {
      resp: 'Renata Camargo Reis', email: 'demo-oficina-vitrin@radar.local', fone: '(11) 95512-9090',
      razao: 'Funilaria Premium Reis LTDA', cnpj: '66778899000111',
      end: 'Rua Domingos de Morais, 220', cidade: 'São Paulo',
      serv: 'Funilaria, Pintura, Martelinho',
      desc: 'Amassados, pintura e retorno de fábrica. Chapa precisa e prazo combinado antes de começar.',
      hor: 'Seg–Sex, 09:00–18:00', cor: [200, 140, 170], garagem: 1,
      esp: ['Funilaria e pintura', 'Segurança veicular', 'Revisão e manutenção'],
    },
  ];
  const oficinaIds = [];
  for (const o of oficinas) {
    const uid = await criarUsuario('workshop', o.resp, o.email, o.fone);
    const { lastInsertId } = await run(
      `INSERT INTO workshops(user_id,legal_name,cnpj,address,city,description,services,opening_hours,photo,photo_mime,garagem)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, o.razao, o.cnpj, o.end, o.cidade, o.desc, o.serv, o.hor, bytesDeOficina(o.cor), 'image/png', o.garagem]
    );
    const oficinaId = Number(lastInsertId);
    oficinaIds.push(oficinaId);
    // esp_ofc: N:N entre oficina e especialidade.
    for (const nome of o.esp) {
      if (espIds[nome]) {
        await run('INSERT OR IGNORE INTO esp_ofc(oficina_id,especialidade_id) VALUES(?,?)', [oficinaId, espIds[nome]]);
      }
    }
    console.log(`  #${lastInsertId} ${o.razao} ${o.cidade}${o.garagem ? ' (garagem)' : ''} · ${o.esp.length} especialidade(s)`);
  }

  // ------------------------------------------------------------- clientes
  console.log('\nClientes, enderecos e veiculos:');
  // O primeiro endereco e o principal; o segundo mostra que o N:N aguenta mais
  // de um (endereco_cliente).
  const clientes = [
    {
      nome: 'Marina Alves Costa', email: 'demo-cliente-marina@radar.local', fone: '(11) 98877-6655', cpf: '52998224725',
      enderecos: [
        ['05435-030', 'São Paulo', 'Rua Augusta', 1500, 'Jardim Paulista', 'Apto 92'],
        ['01311-000', 'São Paulo', 'Av. Paulista', 1000, 'Bela Vista', 'Conj. 12'],
      ],
      veiculos: [
        ['Honda', 'Civic Si', 'ABC-1D23', 2020, 'Prata', 'Flex', 78500, 'Revisar pastilhas a cada 20.000 km. Escape com ruído em rotação.', 'civic', '9BWZZZ377VT004251'],
        ['Toyota', 'Corolla', 'XYZ-9876', 2018, 'Branco', 'Flex', 132000, 'Luz de check engine acende de vez em quando.', 'corolla', '8AJFA6CS0J1234567'],
      ],
    },
    {
      nome: 'Diego Ferreira Lima', email: 'demo-cliente-diego@radar.local', fone: '(11) 95544-3322', cpf: '11144477735',
      enderecos: [['04121-001', 'São Paulo', 'Rua das Palmeiras', 340, 'Água Branca', '']],
      veiculos: [
        ['Volkswagen', 'Saveiro Robust', 'KLM-4C21', 2019, 'Cinza', 'Flex', 96000, 'Batida leve na roda dianteira esquerda.', 'utilitario', '9BWZZZ3771K009876'],
        ['Chevrolet', 'Onix Plus', 'RST-7B45', 2022, 'Azul', 'Flex', 41000, '', 'onix', '93TJSJZ0E7N012345'],
      ],
    },
    {
      nome: 'Paula Nogueira', email: 'demo-cliente-paula@radar.local', fone: '(11) 96633-1188', cpf: '38083628859',
      enderecos: [['13010-100', 'Campinas', 'Rua Barao de Jaguara', 880, 'Centro', 'Sala 3']],
      veiculos: [
        ['Ford', 'Ranger XLS', 'QWE-7R45', 2021, 'Preto', 'Diesel', 88200, 'Preparar para estrada de terra.', 'ranger', '8AFAR23L9KJ045612'],
        ['Fiat', 'Uno', 'JHG5E60', 2015, 'Vermelho', 'Gasolina', 210400, 'Porta-malas não fecha direito.', 'compacto', '93YBT01Z4EJ778899'],
      ],
    },
    {
      nome: 'Rafael Antunes Dias', email: 'demo-cliente-rafael@radar.local', fone: '(11) 94120-3344', cpf: '14625735849',
      enderecos: [
        ['07010-000', 'Guarulhos', 'Av. Monteiro Lobato', 700, 'Centro', ''],
        ['04001-000', 'São Paulo', 'Rua Augusta', 55, 'Bela Vista', 'Conj. 91'],
      ],
      veiculos: [
        ['Toyota', 'Hilux SRV', 'PLK-9A11', 2022, 'Cinza', 'Diesel', 54000, 'Preparando para acampar.', 'ranger', '8AJFA3CD0M123456'],
        ['Renault', 'Kwid', 'RST-2B34', 2020, 'Branco', 'Flex', 68000, 'Barulho na suspensão traseira.', 'compacto', '93YBT01Z4EJ445566'],
      ],
    },
    {
      nome: 'Camila Bastos Lima', email: 'demo-cliente-camila@radar.local', fone: '(19) 98845-7712', cpf: '09183476525',
      enderecos: [['13080-000', 'Campinas', 'Rua das Industrias', 90, 'Nova Odessa', 'Galpão 2']],
      veiculos: [
        ['Mercedes-Benz', 'Acco 815', 'MNO-4C56', 2019, 'Branco', 'Diesel', 132000, 'Escapamento com cheiro forte.', 'utilitario', '9BM958344JB012345'],
        ['Honda', 'Fit', 'STU-7V89', 2018, 'Prata', 'Flex', 91000, 'Ar-condicionado não gela.', 'compacto', '93HAB1D2EJ101010'],
      ],
    },
    {
      nome: 'João Pedro Salgueiro', email: 'demo-cliente-joao@radar.local', fone: '(11) 98007-6543', cpf: '63528147039',
      enderecos: [['02516-000', 'São Paulo', 'Rua João Florêncio', 40, 'Lapa', 'Casa 2']],
      veiculos: [
        ['Peugeot', '207 SW', 'BCD-3D45', 2016, 'Cinza', 'Flex', 118000, 'Faróis embaçados.', 'compacto', '8AG2BR0E5HZ112233'],
        ['Mitsubishi', 'L200 Sport', 'EFG-6H78', 2021, 'Branco', 'Diesel', 76000, 'Diffencial estala em marcha ré.', 'ranger', '93YBT01Z4EJ998877'],
      ],
    },
  ];
  const veicPorEmail = {};
  for (const c of clientes) {
    const uid = await criarUsuario('client', c.nome, c.email, c.fone, c.cpf);
    veicPorEmail[c.email] = [];
    // Endereco + vinculo N:N (endereco_cliente).
    for (const [cep, cidade, rua, numero, bairro, complemento] of c.enderecos) {
      await gravaEnderecoDoCliente(uid, { cep, cidade, rua, numero, bairro, complemento });
    }
    for (const [marca, modelo, placa, ano, cor, comb, km, notas, chave, chassi] of c.veiculos) {
      const { lastInsertId } = await run(
        `INSERT INTO vehicles(client_id,make_model,plate,year,brand,model,color,fuel,mileage,notes,chassi)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [uid, `${marca} ${modelo}`, placa, ano, marca, modelo, cor, comb, km, notas, chassi]
      );
      const vid = Number(lastInsertId);
      veicPorEmail[c.email].push(vid);
      for (let i = 0; i < 3; i++) {
        await run('INSERT INTO vehicle_images(vehicle_id,mime,data) VALUES(?,?,?)',
          [vid, 'image/png', bytesDeVeiculo(chave, i)]);
      }
      console.log(`  ${c.nome} ${marca} ${modelo} ${placa} 3 foto(s)`);
    }
  }

  // ------------------------------------------------------------- pedidos
  console.log('\nPedidos, orcamentos e avaliacoes:');
  async function pedido(cliId, ofiId, veicId, servico, descricao, status, orcamento = null, avaliacao = null, fotos = 0, chave = 'civic') {
    const { lastInsertId } = await run(
      `INSERT INTO requests(client_id,workshop_id,vehicle_id,service_type,description,status)
       VALUES(?,?,?,?,?,?)`,
      [cliId, ofiId, veicId, servico, descricao, status]
    );
    const rid = Number(lastInsertId);
    if (orcamento) {
      await run('INSERT INTO quotes(request_id,message,amount_min,amount_max) VALUES(?,?,?,?)',
        [rid, orcamento.msg, orcamento.min, orcamento.max]);
    }
    if (avaliacao) {
      await run('INSERT INTO reviews(workshop_id,client_id,request_id,rating,comment) VALUES(?,?,?,?,?)',
        [ofiId, cliId, rid, avaliacao.nota, avaliacao.comentario]);
    }
    for (let i = 0; i < fotos; i++) {
      await run('INSERT INTO request_images(request_id,mime,data) VALUES(?,?,?)',
        [rid, 'image/png', bytesDoProblema(chave ?? 'civic', i)]);
    }
    console.log(`  #${rid} ${status.padEnd(11)} ${servico.padEnd(26)} ${fotos} foto(s)${avaliacao ? '  (' + '*'.repeat(avaliacao.nota) + ')' : ''}`);
    return rid;
  }

  const marina = await idUsuario('demo-cliente-marina@radar.local');
  const diego = await idUsuario('demo-cliente-diego@radar.local');
  const paula = await idUsuario('demo-cliente-paula@radar.local');
  const [silva, eletrica, pneus] = oficinaIds;

  await pedido(diego, eletrica, veicPorEmail['demo-cliente-diego@radar.local'][0],
    'Diagnóstico eletrônico', 'A luz do check engine acendeu e o carro falhou na hora de dar partida.', 'responded',
    { msg: 'Passamos o scanner completo. Suspeita de sensor de rotação ou bobina. Recomendamos inspeção presencial para confirmar.', min: 180, max: 320 });

  await pedido(paula, pneus, veicPorEmail['demo-cliente-paula@radar.local'][0],
    'Montagem e balanceamento', 'Preciso trocar os quatro pneus e fazer o balanceamento.', 'in_progress',
    { msg: 'Temos os pneus em estoque. O balanceamento sai no mesmo dia.', min: 640, max: 900 }, null, 1, 'ranger');

  await pedido(marina, silva, veicPorEmail['demo-cliente-marina@radar.local'][1],
    'Revisão / manutenção', 'Revisão completa, o carro estava com o óleo bem vencido.', 'completed',
    { msg: 'Revisão completa: óleo, filtros, freios e alinhamento. Tudo dentro do orçamento.', min: 950, max: 1250 },
    { nota: 5, comentario: 'Atendimento excelente. Explicaram cada item do orçamento antes de começar e o carro saiu impecável. Recomendo demais.' }, 2, 'corolla');

  await pedido(diego, silva, veicPorEmail['demo-cliente-diego@radar.local'][1],
    'Freios e suspensão', 'Pastilhas dianteiras gastas e fazendo barulho.', 'completed',
    { msg: 'Troca de pastilhas e retifica dos discos. Alinhamento incluso.', min: 520, max: 680 },
    { nota: 4, comentario: 'Bom trabalho e preço justo. Só demorou um pouco mais do que o previsto para entregar.' }, 1, 'onix');

  await pedido(paula, eletrica, veicPorEmail['demo-cliente-paula@radar.local'][1],
    'Diagnóstico eletrônico', 'Porta-malas não fecha e o vidro elétrico desce sozinho.', 'completed',
    { msg: 'O problema era o módulo do vidro. Programamos e testamos tudo.', min: 280, max: 420 },
    { nota: 3, comentario: 'Resolveram o vidro, mas fiquei esperando bastante tempo na recepção sem retorno.' });

  await pedido(marina, pneus, veicPorEmail['demo-cliente-marina@radar.local'][0],
    'Borracharia', 'Rodízio dianteiro vibra em velocidade alta.', 'completed',
    { msg: 'Balanciamos e alinhamos as rodas. Vibração resolvida.', min: 180, max: 260 },
    { nota: 5, comentario: 'Rápido e cuidadoso. Fizeram o balanceamento e explicaram como calibrar a pressão.' }, 1, 'civic');

  await pedido(diego, eletrica, null,
    'Revisão / manutenção', 'Troca de óleo e filtros do carro da minha esposa.', 'completed',
    { msg: 'Revisão básica executada, sem pendências.', min: 420, max: 520 },
    { nota: 4, comentario: 'Bom preço e serviço correto. Voltaremos para a próxima revisão.' });

  // Concluidos SEM avaliacao: e o que permite exercitar a avaliacao (RF12).
  await pedido(paula, silva, veicPorEmail['demo-cliente-paula@radar.local'][0],
    'Freios e suspensão', 'Pastilhas e discos dianteiros gastos, com chiado ao frear.', 'completed',
    { msg: 'Substituímos pastilhas, retificamos os discos e balanceamos. Pode retirar hoje.', min: 780, max: 1050 }, null, 2, 'ranger');

  await pedido(marina, eletrica, veicPorEmail['demo-cliente-marina@radar.local'][0],
    'Diagnóstico eletrônico', 'Farol direito está com a lente trincada e acendeu a luz de falha.', 'completed',
    { msg: 'Trocamos a lente e conferimos a fiação. Testamos tudo com a luz acesa.', min: 240, max: 360 }, null, 1, 'civic');

  await pedido(marina, silva, veicPorEmail['demo-cliente-marina@radar.local'][0],
    'Freios e suspensão', 'Chiado ao frear e o pedal está mais mole que o normal.', 'open', null, null, 2, 'civic');

  await pedido(paula, silva, veicPorEmail['demo-cliente-paula@radar.local'][0],
    'Revisão / manutenção', 'Orçamento de revisão do Ranger.', 'cancelled',
    { msg: 'Podemos fazer na próxima semana.', min: 1200, max: 1500 });

  // ------------------------------------------------- cobertura da rede
  // Garante que toda oficina e todo cliente tenham ao menos um pedido: sem
  // isso, uma oficina nova entraria com o painel vazio e nao daria para
  // testar nada nela.
  const SERVICES = [
    ['Revisão / manutenção', 'Revisão completa do veículo, com troca de filtros.', 620, 980, 0],
    ['Freios e suspensão', 'Pastilhas e discos gastos, com chiado ao frear.', 480, 860, 1],
    ['Diagnóstico eletrônico', 'Luz de falha acesa e o motor falhando na partida.', 180, 380, 0],
    ['Borracharia', 'Preciso trocar os pneus e fazer o balanceamento.', 520, 980, 1],
    ['Ar-condicionado', 'O ar-condicionado não está gelaando.', 280, 520, 0],
    ['Elétrica automotiva', 'A bateria descarrega rápido e o carro não pega.', 240, 460, 0],
    ['Funilaria e pintura', 'Amassado na porta do motorista, preciso repintar.', 900, 1800, 1],
    ['Turbo e diesel', 'Escapamento com cheiro forte e vibração em rotação.', 650, 1400, 0],
  ];
  const KEYS = ['civic', 'corolla', 'ranger', 'onix', 'compacto', 'utilitario'];
  const COMENTARIOS = [
    'Atendimento rápido e atencioso. Explicaram tudo antes de começar.',
    'Serviço correto e preço justo. Voltarei para a próxima revisão.',
    'Resolveram o problema no mesmo dia. Recomendo.',
    'Bom trabalho, mas demorou um pouco mais que o combinado.',
    'Preço acima do que eu esperava, mas o serviço ficou impecável.',
  ];

  const emailsClientes = clientes.map((c) => c.email);
  const usadosPorOficina = new Set();
  const usadosPorCliente = new Set();
  for (const o of await all('SELECT DISTINCT workshop_id id FROM requests')) usadosPorOficina.add(Number(o.id));
  for (const r of await all('SELECT DISTINCT client_id id FROM requests')) usadosPorCliente.add(Number(r.id));
  for (const c of await all(`SELECT DISTINCT client_id id FROM reviews`)) usadosPorCliente.add(Number(c.id));

  const semOficina = oficinaIds.filter((id) => !usadosPorOficina.has(id));

  // Uma volta por oficina sem historico e por cliente sem historico.
  let passo = 0;
  for (const ofiId of semOficina) {
    const [servico, descricao, min, max, fotos] = SERVICES[passo % SERVICES.length];
    const email = emailsClientes[passo % emailsClientes.length];
    const veics = veicPorEmail[email];
    await pedido(
      await idUsuario(email), ofiId, veics[passo % veics.length],
      servico, `${descricao} (pedido enviado pela rede)`,
      'responded',
      { msg: 'Recebemos seu pedido. Orçamos abaixo e retornamos em até um dia útil.', min, max },
      null, fotos, KEYS[passo % KEYS.length]
    );
    usadosPorOficina.add(ofiId);
    usadosPorCliente.add(Number(await idUsuario(email)));
    passo++;
  }
  for (let i = 0; i < clientes.length; i++) {
    const cliId = Number(await idUsuario(clientes[i].email));
    if (usadosPorCliente.has(cliId)) continue;
    const [servico, descricao, min, max, fotos] = SERVICES[(i + passo) % SERVICES.length];
    const veics = veicPorEmail[clientes[i].email];
    const nota = 3 + (i % 3);
    await pedido(
      cliId, oficinaIds[i % oficinaIds.length], veics[i % veics.length],
      servico, descricao, 'completed',
      { msg: 'Serviço executado e conferido com o cliente na retirada.', min, max },
      { nota, comentario: COMENTARIOS[i % COMENTARIOS.length] }, fotos, KEYS[i % KEYS.length]
    );
    usadosPorCliente.add(cliId);
  }
  console.log(`  cobertura: ${semOficina.length} oficina(s) e ${clientes.length} cliente(s) sem historico`);

  for (const wid of oficinaIds) await syncWorkshopRating(wid);

  // ------------------------------------------------------------- resumo
  console.log('\n--- resultado ---');
  for (const w of await all(
    `SELECT w.legal_name, w.city, COUNT(r.id) n, ROUND(AVG(r.rating),1) med
       FROM workshops w LEFT JOIN reviews r ON r.workshop_id = w.id
      GROUP BY w.id ORDER BY med DESC`
  )) {
    console.log(`  ${w.legal_name.padEnd(26)} ${String(w.city).padEnd(11)} ${w.n} aval.  media ${w.n ? w.med : '—'}`);
  }
  console.log('');
  for (const t of [
    'users', 'workshops', 'vehicles', 'vehicle_images', 'requests', 'quotes', 'reviews', 'request_images',
    'enderecos', 'endereco_cliente', 'especialidades', 'esp_ofc',
  ]) {
    const r = await one(`SELECT count(*) n FROM ${t}`);
    console.log(`  ${t}: ${r.n}`);
  }
  console.log('\nPedidos concluidos aguardando avaliacao:');
  for (const r of await all(
    `SELECT r.id, c.name, w.legal_name FROM requests r
       JOIN users c ON c.id = r.client_id JOIN workshops w ON w.id = r.workshop_id
      WHERE r.status = 'completed' AND r.id NOT IN (SELECT request_id FROM reviews) ORDER BY r.id`
  )) {
    console.log(`  #${r.id}  ${r.name} -> ${r.legal_name}`);
  }
  console.log(`\nContas para entrar (senha ${SENHA}):`);
  for (const u of await all("SELECT role,name,email FROM users WHERE email LIKE 'demo-%' ORDER BY role,name")) {
    console.log(`  ${String(u.role).padEnd(9)} ${String(u.name).padEnd(22)} ${u.email}`);
  }
  console.log('  admin    Administrador Radar  admin@radarmecanico.local  (RadarAdm@2026)');
  await tabelaDeLogins();
}

/** Printa as contas em Markdown, para colar na documentacao. */
async function tabelaDeLogins() {
  const contas = await all(
    `SELECT u.role, u.name, u.email, w.legal_name, w.city,
            (SELECT count(*) FROM requests r WHERE r.workshop_id = w.id) pedidos,
            (SELECT count(*) FROM vehicles v WHERE v.client_id = u.id) veiculos
       FROM users u LEFT JOIN workshops w ON w.user_id = u.id
      WHERE u.email LIKE 'demo-%' OR u.email = 'admin@radarmecanico.local'
      ORDER BY CASE u.role WHEN 'workshop' THEN 1 WHEN 'client' THEN 2 ELSE 3 END, u.name`
  );
  console.log('\n### Logins\n');
  console.log(`| Perfil | Quem entra | E-mail | Senha | O que ja tem |`);
  console.log(`| --- | --- | --- | --- | --- |`);
  for (const c of contas) {
    const quem = c.role === 'workshop' ? c.legal_name : c.name;
    const tem = c.role === 'workshop' ? `${c.pedidos} pedido(s) recebidos`
      : c.role === 'client' ? `${c.veiculos} veículo(s) na garagem`
        : 'contas, bloqueio e troca de senha';
    console.log(`| ${c.role} | ${quem} | \`${c.email}\` | \`${c.role === 'admin' ? 'RadarAdm@2026' : SENHA}\` | ${tem} |`);
  }
}

main().catch((e) => {
  console.error('Falha no seed:', e?.message || e);
  process.exitCode = 1;
});