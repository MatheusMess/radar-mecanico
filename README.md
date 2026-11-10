# Radar Mecânico

Sistema de orçamentos entre Clientes e Oficinas. **HTML, CSS, JavaScript e Postgres** — sem PHP,
sem framework, sem etapa de build.

Roda como site estático na Vercel com funções serverless em JavaScript e o banco no
[Supabase](https://supabase.com) (Postgres gerenciado).

## Como está organizado

```
index.html            página única (shell da aplicação)
app.js                toda a interface: telas, formulários, roteamento por hash
styles.css            design system, tema claro/escuro
assets/               logo oficial (variante branca e preta)
api/
  index.js             roteador único: /api/<recurso> -> handlers/<recurso>.js
handlers/             um arquivo por endpoint (22)
  session.js            quem está logado
  login.js  logout.js  register.js
  profile.js            dados, endereços (cliente) e especialidades (oficina)
  password.js
  vehicles.js  vehicle-upload.js  vehicle-images.js  vehicle-delete.js
  requests.js  request-status.js  request-upload.js  request-images.js
  quote.js
  workshops.js  workshop.js  workshop-photo.js
  reviews.js  especialidades.js
  admin-users.js
  image.js             serve as fotos (BYTEA) com checagem de acesso
lib/
  db.js               schema, consultas e validações de domínio
  pg.js               conexão com o Postgres (Supabase ou PGlite local)
  auth.js             scrypt para senha, cookie de sessão assinado
  http.js             helpers de request/response e guardas
  upload.js           validação de imagens
supabase/
  schema.sql          schema completo, para colar no SQL Editor
scripts/
  envlocal.js         lê .env/.env.local e inventa o que faltar no dev local
  dbpush.js           aplica o schema no banco configurado
  seed.js             dados de demonstração
  check.js            sintaxe, imports e execução de todas as consultas
  testeapi.js         192 asserções sobre os endpoints, com req/res falsos
  testalogins.js      confere que toda conta do seed entra
  devlocal.js         servidor local: arquivos estáticos + /api sem a Vercel
  browsercheck.js     lê o resultado de uma página no navegador (Edge/Chrome)
  desenho.js          desenho das imagens do seed (sem GD)
tests/
  browser.html        percorre as telas do app contra a API de verdade
```

## Tabelas

Doze no total. As quatro com `*_images` são as fotos, guardadas como BYTEA no
Postgres porque uma função serverless da Vercel não tem disco gravável.

| Tabela | O que guarda |
| --- | --- |
| `users` | as três contas: `role` = `client`, `workshop` ou `admin` |
| `workshops` | oficina, com CNPJ, foto, nota e `garagem` |
| `enderecos` | endereço normalizado (cep, cidade, rua, número, bairro, complemento) |
| `endereco_cliente` | N:N entre cliente e endereço |
| `especialidades` | catálogo de especialidades |
| `esp_ofc` | N:N entre oficina e especialidade |
| `vehicles` | veículo do cliente, com `chassi` |
| `vehicle_images` | fotos do veículo |
| `requests` | chamado/pedido de orçamento |
| `request_images` | fotos do problema |
| `quotes` | orçamento enviado pela oficina |
| `reviews` | avaliação do serviço, uma por pedido |

### O que mudou em relação ao desenho original

O desenho de banco de 14 tabelas previa `Usuario`, `Mecanico`, `Administrador`,
`Cliente`, `Veiculo`, `Especialidade`, `esp_mec`, `Oficina`, `esp_ofc`,
`Endereco`, `endereco_cliente`, `Chamados`, `Resgate` e `Agendamento`. A
diferença é de modelo, não de nome:

- **`Mecanico` não existe.** Quem atende o chamado é a **oficina**, não uma
  pessoa. Isso muda `requests` (não há `id_mecanico`) e o fluxo de status:
  uma oficina orça, aceita e conclui. Adicionar mecânicos depois significa dar
  à oficina uma lista de atendentes e trocar `requests.workshop_id` por
  `requests.id_mecanico` — é uma mudança de regra de negócio, não de schema.
- **`Cliente`, `Administrador` e `Usuario` viraram uma tabela só**, com `role`.
  Antes isso dava três tabelas quase idênticas e três logins diferentes para o
  mesmo e-mail.
- **`Resgate` e `Agendamento` não existem** — não há nada no app que os use.
- **`endereco_cliente` é N:N**, como no desenho: um cliente pode ter vários
  endereços (casa, trabalho). O endereço da **oficina** continua em
  `workshops.address`/`city`, porque é um só e é público na busca.
- **`requests.data_hora_criacao` chama-se `created_at`**, com o mesmo formato.
  `chassi`, `garagem` e `detalhes` entraram como colunas.

### Migração

Tabelas novas são criadas sozinhas (`CREATE TABLE IF NOT EXISTS`). Colunas novas
entram por `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, listadas em
`COLUNAS_NOVAS` no `lib/db.js`. Rodar `iniciar()` duas vezes não muda nada — o
`npm run check` verifica isso. O mesmo schema está em `supabase/schema.sql`
para quem preferir rodar uma vez no SQL Editor do Supabase.

## Publicar

### 1. Banco no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (o plano grátis serve).
2. Abra o projeto e clique em **Connect** (ou **Project Settings → Database**) e copie a URI de
   **Session pooler** (porta 5432) ou **Transaction pooler** (porta 6543).
   - **Não use a "Direct connection"**: o host `db.<ref>.supabase.co` só responde por IPv6 e a
     Vercel não tem IPv6. O pooler é IPv4.
   - O host do pooler muda de projeto para projeto (`aws-0-<região>` ou `aws-1-<região>`). Se a
     URI não estiver visível, dá para descobrir por tentativa: um host de região errada responde
     `tenant/user postgres.<ref> not found`.
   - A URI já vem com a senha do banco. Se tiver perdido, dá para redefinir em
     **Database → Reset database password**.
3. Opcional: cole `supabase/schema.sql` no **SQL Editor** e rode. Se não rodar
   nada, a primeira requisição da API cria tudo sozinha.

Depois de configurar a `SUPABASE_DB_URL`, rode `npm run db:push` para conferir as tabelas e
`npm run seed` para os dados de demonstração.

### 2. Na Vercel

1. Importe o repositório.
2. Em **Settings → Environment Variables**, cadastre:
   - `SUPABASE_DB_URL` — a URI do passo 1
   - `SESSION_SECRET` — um valor aleatório longo. Gere com:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
3. Deploy. Não há build command: o projeto é estático.

Se você usar a integração Supabase da Vercel, ela injeta `POSTGRES_URL`
sozinha, e o app aceita essa variável no lugar de `SUPABASE_DB_URL`.

O schema é criado sozinho na primeira requisição, junto com o administrador inicial.

### 3. Administrador inicial

- E-mail: `admin@radarmecanico.local`
- Senha: `RadarAdm@2026`

Troque em **Minha conta → Alterar senha** antes de mostrar para qualquer pessoa.

## Rodar localmente

Precisa do Node 18+ (a Vercel usa a mesma versão).

Há dois jeitos. O mais direto não precisa da Vercel: `scripts/devlocal.js` serve os arquivos e
monta o `/api` chamando os mesmos handlers, com o banco que estiver configurado.

```bash
npm install
npm run seed          # opcional: dados de demonstração
npm run dev           # http://127.0.0.1:8787  (alias: npm run dev:local)
```

O outro usa o runtime da Vercel: `npm run dev:vercel`, em `http://localhost:3000`. (O script
`dev` do `package.json` não pode chamar `vercel dev`, senão o CLI entra em recursão.)

**Não é preciso configurar nada.** Sem um `.env`, o servidor usa um Postgres
embutido em `.local-pg` e gera um `SESSION_SECRET` aleatório, que fica gravado
no `.env.local` (já ignorado pelo git) para que a sessão não caia a cada
reinício. O `.local-pg` é só desenvolvimento — o banco de verdade é o Supabase.

Para apontar para o Supabase também no seu computador, crie um `.env`:

```
SUPABASE_DB_URL=postgresql://postgres.SEU_PROJETO:SENHA@aws-1-REGIAO.pooler.supabase.com:5432/postgres
SESSION_SECRET=<valor aleatorio longo>
```

Com esse `.env` presente, `npm run dev`, `npm run seed` e `npm run test:logins` falam com o banco
de produção. Quem escreve dados é o `seed` (e `npm run test:browser`, que cria veículos e troca a
foto da fachada antes de restaurar) — `npm test` e `npm run check` sempre usam um Postgres
embutido temporário, porque apagam a variável de banco antes de conectar.

Em produção a `SESSION_SECRET` tem que vir das variáveis de ambiente da Vercel
e **não pode mudar**: é ela que assina o cookie de sessão. Se trocar, todas as
sessões abertas caem.

## Dados de demonstração

```bash
npm run seed          # apaga e recria os dados demo
node scripts/seed.js --keep   # acrescenta sem apagar
```

Cria **6 oficinas** com foto, endereço e especialidades, **6 clientes** com 2
veículos cada (12 veículos, 36 fotos), 8 endereços, 13 especialidades, 17 pedidos
cobrindo todos os status, orçamentos, 8 avaliações e 2 serviços **concluídos sem
avaliação** para dar o que avaliar sem precisar criar nada.

A passagem de cobertura no fim do seed garante que toda oficina tenha pelo menos
um pedido e todo cliente pelo menos um histórico — sem isso uma oficina nova
entraria com o painel vazio e não daria para testar nada nela.

O admin e o usuário `matheusmessiaslima13@gmail.com` nunca são tocados.

### Logins

Senha de todas as contas de demonstração: **`Demo@2026`** (admin: `RadarAdm@2026`).

| Perfil | Quem entra | E-mail | O que já tem |
| --- | --- | --- | --- |
| Oficina | Auto Center Silva LTDA | `demo-oficina-silva@radar.local` | 5 pedidos, 3 especialidades |
| Oficina | Auto Elétrica Rocha ME | `demo-oficina-eletrica@radar.local` | 4 pedidos, 4 especialidades |
| Oficina | Pneus & Rodas Tavares LTDA | `demo-oficina-pneus@radar.local` | 2 pedidos, 4 especialidades |
| Oficina | Mecânica Geral Prado LTDA | `demo-oficina-mecanica@radar.local` | 2 pedidos, 3 especialidades |
| Oficina | Diesel & Turbo Lima ME | `demo-oficina-diesel@radar.local` | 2 pedidos, 3 especialidades |
| Oficina | Funilaria Premium Reis LTDA | `demo-oficina-vitrin@radar.local` | 2 pedidos, 3 especialidades |
| Cliente | Marina Alves Costa | `demo-cliente-marina@radar.local` | 2 veículos, 2 endereços |
| Cliente | Diego Ferreira Lima | `demo-cliente-diego@radar.local` | 2 veículos |
| Cliente | Paula Nogueira | `demo-cliente-paula@radar.local` | 2 veículos |
| Cliente | Rafael Antunes Dias | `demo-cliente-rafael@radar.local` | 2 veículos, 2 endereços |
| Cliente | Camila Bastos Lima | `demo-cliente-camila@radar.local` | 2 veículos (Hilux, Acco 815) |
| Cliente | João Pedro Salgueiro | `demo-cliente-joao@radar.local` | 2 veículos |
| Admin | Administrador Radar | `admin@radarmecanico.local` | 13 contas para bloquear |

`npm run seed` imprime essa mesma tabela em Markdown no final, com a contagem
real de cada conta — útil para colar na documentação sem digitar errado.

Para conferir que todas elas entram de verdade (login, sessão e tela principal):

```bash
npm run dev:local    # em outro terminal
npm run seed
npm run test:logins
```

## Testes

```bash
npm run check        # sintaxe, imports e execução das consultas
npm test             # 192 asserções sobre os endpoints
npm run test:logins  # todas as contas do seed entram de verdade
npm run test:browser # as telas do app contra a API (precisa do dev:local no ar)
npm run test:prod    # fumaça contra o site publicado (https://radar-mecanico.vercel.app)
```

`npm run check` não sobe servidor nem usa rede: valida a sintaxe de todos os `.js`, confere se
cada nome importado existe no módulo de origem e executa o schema e todas as consultas contra um
Postgres embutido temporário (PGlite, o mesmo dialeto do Supabase). A sintaxe sai de `node --check`,
que só analisa o arquivo — executar o topo de cada script abria conexões e deixava o processo
pendurado.

`npm test` sobe os handlers em Node com `req`/`res` falsos e um banco próprio. Cobre cadastro,
login, CSRF, garagem, fotos, pedido, orçamento, status, avaliação, administração e as fronteiras
de permissão entre clientes — inclusive o caso em que um cliente tenta ler a foto do pedido de
outro.

`npm run test:prod` é o teste de fumaça contra o site no ar, usando as contas do seed: login dos
três perfis, listagem de oficinas, garagem, upload/leitura da foto de um veículo (multipart +
BYTEA), troca e restauração da foto da fachada e a central de administração. O veículo criado é
excluído no fim e a foto da oficina volta a ser a original. Para apontar para outro endereço:
`node scripts/smoketest.js http://127.0.0.1:8787`.

`npm run test:browser` é o teste de interface: sobe o navegador, entra no app com uma conta de
demonstração e percorre as telas. Para rodá-lo automático, deixe `npm run dev:local` em outro
terminal. O `browsercheck.js` precisa de Edge ou Chrome com porta de depuração remota; o
resultado sai no próprio console.

## Decisões que valem explicar

**As imagens são BYTEA no banco, não arquivos.** Uma função serverless da Vercel não tem disco
gravável, então a foto vai para o Postgres e é servida por `/api/image`. O preço é o limite de
tamanho: 2 MB por imagem e 3 MB por envio (o corpo da requisição é limitado a ~4,5 MB pela
plataforma). Se um dia as fotos crescerem, o caminho natural é trocar o BYTEA pelo Supabase
Storage e guardar só o caminho da imagem na tabela.

**Na Vercel, multipart chega sem `req.body`.** O parser da plataforma entende JSON e formulário
urlencoded; para `multipart/form-data` ela deixa `req.body` indefinido, mas o stream continua
intacto. Por isso `api/index.js` lê os bytes do próprio `req` e passa por `lib/multipart.js` —
o mesmo módulo que o servidor de desenvolvimento usa. Sem isso, o upload da foto da oficina
funcionava local e falhava em produção com "Selecione uma imagem".

**A foto da fachada é redimensionada no navegador antes de subir.** Uma foto de celular tem
4000 px e 4 MB; ia para o banco inteira e o card baixava tudo isso para exibir 300 px. O
`prepararFotoFachada` desenha num `canvas` de no máximo 1600 px e baixa a qualidade em
passos (0.86 → 0.74 → 0.6 → 0.5, o último também corta as dimensões) até caber em 2 MB. O
usuário vê a prévia com o tamanho final antes de enviar, então o resultado nunca é surpresa.

**Trocar a foto muda a URL da imagem.** `workshops.photo_rev` é um contador que incrementa a
cada troca, e a URL sai como `/api/image?tipo=workshop&id=N&v=REV`. Sem isso o navegador
serviria a imagem anterior do cache por 24 h e o dono nunca veria o resultado do upload. O
endpoint ainda responde com **ETag** (hash do conteúdo) e `must-revalidate`: sem mudança, a
resposta é `304` e não trafega nada; com mudança, a foto nova chega na hora.

**A foto pode ser removida.** `POST operation=remove` limpa a coluna e incrementa a revisão,
então o card volta ao estado sem imagem em vez de ficar preso numa foto errada.

**Os modais são uma pilha, não um `id="modal"` só.** Abrir a foto ampliada sobre a lista de
fotos criava um segundo elemento com o mesmo id, e o "fechar" pegava o primeiro da lista — o
de baixo. O sintoma era a lista sumir e a foto ficar aberta. Agora cada camada guarda o próprio
elemento, fechar sempre age na de cima, e a camada de baixo **encolhe e escurece** para ficar
claro qual está na frente. Também: `Esc` sobe uma camada, clicar fora fecha a de cima, `Tab`
fica preso na camada de cima, e o foco volta para onde estava.

**A sessão é um cookie assinado, não um arquivo.** No PHP a sessão vivia em `storage/sessions`;
isso não funciona em serverless. Agora o cookie `sessao` carrega `id do usuário + validade`
assinados com HMAC-SHA256 e lidos por qualquer instância. `HttpOnly` + `SameSite=Lax` + `Secure`
em produção.

**A proteção contra CSRF é o header `X-Requested-With`.** O token em sessão não existe mais porque
não há estado no servidor. O header não é enviado por um `<form>` de outro site, e o `Origin` é
conferido quando presente.

**A senha usa scrypt** (`node:crypto`), com sal por usuário e comparação em tempo constante.

**`app.js` é um script clássico, não um módulo.** Os templates usam `onclick="go('requests')"`, e um
atributo `on*` inline é compilado no escopo global: em um `<script type="module">` as funções não
estariam em `window` e nenhum botão funcionaria. Por isso `app.js` não usa `import`/`export` e é
carregado no fim do `<body>`, depois do `#app`.

**`lib/upload.js` aceita três formatos de upload.** O campo vai como `images[]`, mas o parser
depende do runtime: pode chegar como `{ data, filename, mimetype }` único, como array desses
objetos, ou o corpo cru. O `normalizarUploads` trata os três. Os bytes também são conferidos, não
só o MIME declarado, porque o arquivo é servido de volta com esse `Content-Type`.

**`requests.vehicle_id` é `ON DELETE SET NULL`.** Sem isso, um veículo citado por algum pedido
ficaria impossível de excluir da garagem: o `DELETE` falharia por chave estrangeira.

**Placa: `ABC1D23` (Mercosul) e `ABC1234` (antiga).** A regex antiga rejeitava todas as placas
Mercosul, que são o padrão desde 2018. O banco guarda sem separador para evitar duplicatas e a
tela mostra com hífen.

## Requisitos do diagrama ainda não implementados

- **RF03** — foto no cadastro do usuário (a foto da oficina e as fotos do
  problema já existem). **RF04** ficou só o endereço, sem geolocalização.
- **RF06** — serviços com preços estimados.
- **RF07/RF08** — ordenação por proximidade e filtro por raio de distância (hoje
  só há o filtro por avaliação).
- Diagrama físico: `Mecanico` + `esp_mec`, `Resgate`, `Agendamento`, e a tabela
  `endereco` aplicada também à oficina.

## Primeiro teste depois do deploy

Rode `npm run test:prod`. Ele faz o caminho que mais depende da plataforma, contra o site no ar:
cria um veículo, sobe a foto (multipart), confere os bytes servidos por `/api/image`, troca a foto
da fachada da oficina, confere de novo, restaura a original, e termina na central de
administração. Se algo passar local e falhar em produção, o suspeito número um é o corpo da
requisição — `api/index.js` já trata o caso em que a Vercel entrega `multipart/form-data` sem
`req.body`, mas vale conferir se a plataforma mudou o comportamento.