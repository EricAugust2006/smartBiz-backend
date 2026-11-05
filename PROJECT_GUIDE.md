# 📘 PROJECT GUIDE - SmartBiz AI (Back-end Core)

## 1. Por Que Este Projeto Existe? (Propósito e Valor)
Pequenos e médios estabelecimentos locais (restaurantes, barbearias, cafés, pet shops) sofrem com três dores crônicas:
1. **Clientes de visita única:** Falta de incentivo moderno para retorno recorrente.
2. **Desperdício e Perda em Estoque:** Insumos e produtos que vencem sem controle de giro.
3. **Falta de Gestão Ativa:** Proprietários ocupados demais na operação diária para analisar números e margens.

O **SmartBiz AI** funciona como um **"Sócio Virtual Proativo"**. Ele unifica:
- **Clube VIP & Gamificação (PWA):** Substitui cartões de papel por Níveis (Bronze a Black), Missões da IA e Menus Secretos.
- **Estoque Inteligente:** Mapeia giro e validade, acionando promoções inteligentes via PWA antes dos insumos estragarem.
- **Copiloto no WhatsApp:** Envia resumos matinais, metas diárias, calcula alteração de margem de lucro e atende dúvidas por texto e áudio no WhatsApp.

---

## 2. Mapeamento da Estrutura de Diretórios (`src/`)

```
src/
├── common/                  # Recursos utilitários compartilhados por toda a aplicação
│   ├── decorators/          # Decoradores customizados NestJS (@CurrentTenant, @CurrentUser)
│   ├── filters/             # Tratamento global de exceções
│   └── guards/              # Proteção de rotas (JwtAuthGuard, TenantGuard)
├── database/                # Conexão e integração com o banco de dados
│   ├── prisma.service.ts    # Instância única do Prisma Client
│   └── database.module.ts   # Módulo exportador do banco
├── modules/                 # Módulos funcionais isolados
│   ├── ai-copilot/          # Integração OpenAI + Function Calling + Prompts
│   ├── auth/                # Autenticação, geração de tokens JWT e hash de senhas
│   ├── customers/           # Clientes finais, pontuação e níveis (Bronze-Black)
│   ├── inventory/           # Cadastro de estoque, verificação de validade e margens
│   ├── missions/            # Motor de regras e geração de missões gamificadas
│   ├── tenants/             # Gestão de empresas cadastras (Multi-tenancy)
│   └── whatsapp/            # Filas BullMQ e mensageria para o WhatsApp
├── app.module.ts            # Módulo raiz da aplicação NestJS
└── main.ts                  # Ponto de entrada (Bootstrap) e pipes globais
```

---

## 3. Dicionário de Elementos e Componentes

### 3.1 Arquivos Raiz
- `main.ts`: Inicializa o servidor NestJS na porta 3000, configura a validação global de DTOs (`ValidationPipe`) e ativa a inicialização graciosa (`enableShutdownHooks`).
- `app.module.ts`: Módulo principal que importa todas as variáveis de ambiente (`ConfigModule`), filas (`BullModule`) e os submódulos da aplicação.

### 3.2 Common (Recursos Globais)
- `@CurrentTenant()` Decorator: Extrai de forma limpa o `tenantId` inserido no token JWT pelo `JwtStrategy`.
- `TenantGuard`: Garante que qualquer requisição operacional esteja vinculada a um estabelecimento válido, bloqueando requisições cruzadas não autorizadas.

### 3.3 Módulos de Negócio (`src/modules/`)

#### A. Auth & Tenants
- `AuthService`: Cadastra empresa e proprietário, valida credenciais com `bcryptjs` e emite JWT B2B com `sub`, `tenantId`, `role` e `userRole`.
- `TenantsService`: Cadastra empresa e proprietário na mesma operação e consulta os dados públicos da empresa autenticada.
- `JwtStrategy` e `JwtAuthGuard`: Validam o token Bearer e impedem o acesso ao GET de empresa sem uma identidade válida.

#### Endpoints disponíveis

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `POST` | `/auth/register` | Público | Cadastra empresa e OWNER com slug gerado pelo servidor |
| `POST` | `/tenants` | Público | Cadastra uma empresa e seu proprietário |
| `POST` | `/auth/login` | Público | Autentica por e-mail e senha e retorna um JWT |
| `GET` | `/tenants/me` | JWT Bearer | Retorna somente a empresa associada ao token |

Exemplo de cadastro B2B em `POST /auth/register`:

```json
{
  "tenantName": "Café Central",
  "userName": "Ana Silva",
  "email": "ana@example.com",
  "password": "uma-senha-com-8-ou-mais-caracteres"
}
```

Os quatro campos são obrigatórios. Nome da loja e nome do usuário aceitam até
120 caracteres. E-mail aceita até 254 caracteres. Espaços nas extremidades dos
nomes e do e-mail são removidos; a senha é preservada exatamente como recebida.
O e-mail é comparado como armazenado, mantendo o comportamento existente.

O `AuthService.register` abre uma transação Prisma, cria a empresa, calcula o hash
com `bcryptjs` custo 12 e cria o usuário com `Role.OWNER`, ligado ao ID da empresa
recém-criada. Senhas exigem ao menos oito caracteres e no máximo 128; o limite
adicional de 72 bytes UTF-8 do bcrypt é validado para impedir truncamento silencioso.
O timeout da transação é de 15 segundos para incluir o trabalho de hashing.
Falhas no hash, gravação do usuário ou unicidade desfazem a criação da empresa.

O slug é gerado a partir do nome, com sufixo UUID e limite de 80 caracteres.
Lojas com o mesmo nome podem ser cadastradas com e-mails distintos. O servidor
define o papel `OWNER`; `role`, `userRole`, `tenantId`, `plan`, `slug` e
`passwordHash` não são aceitos nesse payload. Cadastro válido retorna `201` com
`tenant` e `user` públicos; duplicidade retorna `409`, e dados inválidos, `400`.

O fluxo público de cadastro/login identifica ou cria o tenant antes de haver uma
sessão autenticada. O login consulta o e-mail globalmente único para validar a
credencial; as operações protegidas continuam recebendo o tenant exclusivamente
do token e usando filtros de isolamento.

O endpoint anterior `POST /tenants` continua disponível com seu contrato existente:

```json
{
  "name": "Café Central",
  "slug": "cafe-central",
  "ownerName": "Ana Silva",
  "email": "ana@example.com",
  "password": "uma-senha-com-8-ou-mais-caracteres",
  "whatsappNumber": "+5511999999999"
}
```

O campo `whatsappNumber` é opcional. O papel inicial do proprietário é definido pelo servidor como `OWNER`; campos como `role`, `plan`, `tenantId` e `passwordHash` não podem ser definidos pelo cliente. O cadastro retorna HTTP `201`, credenciais duplicadas retornam `409`, e dados inválidos retornam `400`.

Exemplo de login:

```json
{
  "email": "ana@example.com",
  "password": "uma-senha-com-8-ou-mais-caracteres"
}
```

O login retorna HTTP `200` com `access_token`, dados públicos do usuário e dados públicos da empresa. Credenciais inválidas retornam HTTP `401` sem diferenciar e-mail inexistente de senha incorreta. Nenhuma resposta inclui o hash de senha.

Para consultar a empresa, envie o token retornado pelo login:

```http
GET /tenants/me
Authorization: Bearer <access_token>
```

O GET retorna HTTP `200` com os dados públicos da empresa do token; sem token válido retorna HTTP `401`, e se a empresa não existir mais retorna HTTP `404`. O endpoint não lista empresas nem usa um `tenantId` fornecido pelo cliente.

Configure `JWT_SECRET` com um segredo forte e exclusivo fora do controle de versão.
O JWT B2B usa assinatura HS256 e validade fixa de **86.400 segundos (24 horas)**.
O valor antigo de `JWT_EXPIRATION` não altera essa validade. O servidor falha ao
iniciar a autenticação se o segredo estiver ausente ou vazio. Refresh Token fica
para uma etapa futura; após a expiração, o usuário faz login novamente.

Claims emitidas pelo login:

```json
{
  "sub": "id-do-usuario",
  "tenantId": "id-da-loja",
  "role": "B2B",
  "userRole": "OWNER"
}
```

O JWT também contém `iat` e `exp`, cuja diferença é exatamente 24 horas. `role`
identifica o público B2B; `userRole` representa a permissão de negócio existente
no Prisma (`OWNER`, `STAFF` ou `ADMIN`). No JSON público do usuário, `user.role`
continua representando essa permissão de negócio.

`JwtStrategy` e `JwtAuthGuard` verificam assinatura HS256, expiração obrigatória,
`role: 'B2B'` e `userRole` válido. O `req.user` passa a conter `userId`, `tenantId`,
`role: 'B2B'` e `userRole`. `@CurrentTenant()` continua fornecendo a loja para
Sales, Customers, Missions e demais rotas protegidas; `@CurrentUser()` fornece o
contexto B2B tipado. Os decorators rejeitam contexto ausente com `401`.

Tokens antigos com `role: 'OWNER'` ou `role: 'STAFF'` precisam ser substituídos
pelo token retornado por um novo login. Tokens B2C continuam sendo verificados
pela estratégia própria e não autenticam as rotas B2B. Esta atualização usa os
modelos existentes de `Tenant` e `User`, sem nova migração.

#### A.1 Clientes e vendas no balcão — MVP

Todas as rotas abaixo exigem JWT Bearer do painel B2B. Os controllers usam
`JwtAuthGuard` e `@CurrentTenant()`. O servidor determina `tenantId`, funcionário,
tipo da venda e campos de fidelidade; esses campos não são aceitos no corpo.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/customers` | Cadastra um cliente no estabelecimento autenticado |
| `GET` | `/customers/by-phone?phone=11999990000` | Busca pelo telefone dentro do estabelecimento |
| `POST` | `/sales` | Registra uma compra confirmada pelo funcionário autenticado |

Cadastro de cliente:

```json
{
  "name": "Ana Silva",
  "phone": "(11) 99999-0000",
  "cpf": "529.982.247-25"
}
```

Nome e telefone são obrigatórios; CPF é opcional e tem os dígitos verificadores
validados. Telefones brasileiros com DDD são normalizados para `+55…`;
números internacionais devem incluir `+` e código do país. Ao enviar um telefone
internacional na query, use URL encoding para o sinal `+` (`%2B`). CPF é armazenado
sem pontuação. Telefone e CPF são únicos por estabelecimento; duplicidades
retornam `409`. O mesmo cliente pode ter cadastros independentes em lojas diferentes.
Identificadores inválidos retornam `400`; cliente não encontrado na loja retorna `404`.

Registro de venda:

```json
{
  "idempotencyKey": "e6b0a675-e3f5-4ab1-8ef6-538904b165a1",
  "amount": 19.90,
  "customerPhone": "(11) 99999-0000",
  "items": [
    {
      "productId": "d679aa99-3174-4d1b-a890-b35d184cbba3",
      "quantity": 2,
      "unitPrice": 9.95
    }
  ]
}
```

- Gere uma UUID v4 por operação de venda e reutilize a mesma `idempotencyKey` em
  retries. Uma repetição equivalente retorna a mesma venda; reutilizar a chave
  com outro conteúdo ou funcionário retorna `409`. A chave é independente por loja.
- `customerId` pode substituir `customerPhone`; envie apenas um dos dois.
  Sem ambos, a venda é anônima. Cliente informado e inexistente retorna `404`;
  não há criação automática nem conversão silenciosa para venda anônima.
- `items` é opcional para venda apenas por valor. Quando enviado, deve conter
  de 1 a 100 produtos distintos da própria loja, com quantidades inteiras positivas.
  O preço unitário é informado pelo funcionário, e o total deve ser exatamente
  a soma dos itens. Descontos separados e quantidades fracionárias não fazem parte
  deste contrato inicial.
- Valores são números JSON em reais, com até duas casas decimais. O valor total
  deve ser positivo e menor que R$ 10 bilhões. Os cálculos e a persistência usam
  `Decimal`; valores monetários na resposta são strings para preservar precisão.
- A venda mantém nome e preço dos itens no momento do registro e o funcionário
  responsável. O serviço verifica novamente o vínculo desse funcionário com a loja.
- O ID de cliente pode ser obtido pela leitura do QR no painel; este endpoint
  recebe o ID, e a compra é confirmada pela ação autenticada do funcionário.
  A geração e leitura visual dos códigos QR serão implementadas na experiência cliente/painel.

Venda, itens e evento `sale.confirmed` são gravados em uma transação PostgreSQL.
Para compras identificadas, o evento fica na tabela `outbox_events` com valor
exato, moeda, cliente, loja e instante da compra. Isso prepara a integração com
o futuro consumidor de fidelidade sem depender de disponibilidade do Redis
durante o registro. Vendas anônimas não geram evento de pontos nesta etapa.

Todas as compras identificadas geram um evento, mesmo quando ocorrem em sequência.
O `LoyaltyModule` consome esses eventos conforme a seção seguinte. O registro de
venda não altera saldo de estoque nem implementa cancelamento ou associação
posterior de venda anônima.

#### A.2 Fidelidade: consumidor durável e extrato imutável

O `LoyaltyOutboxConsumer` verifica a outbox a cada cinco segundos, sem sobrepor
execuções na mesma instância. O diretório de empresas é paginado e retorna apenas
IDs; todas as consultas e alterações de eventos, clientes, vendas, missões e
extrato são executadas separadamente com `tenantId` explícito. Cada passagem
examina até 50 empresas e até 100 eventos disponíveis por empresa. O cursor
circula entre empresas para que instalações com mais de 50 lojas sejam atendidas.

O `LoyaltyService.processEvent(tenantId, eventId)` executa uma transação Prisma
com isolamento `Serializable`. Ela reivindica o evento pendente, relê a venda
persistida, credita o saldo, avalia missões, insere o `PointsLedger` e conclui o
evento. Todos esses efeitos só ficam visíveis juntos no commit. Conflitos de
serialização são tentados novamente até cinco vezes. A reivindicação condicional
e as constraints únicas impedem que instâncias concorrentes dupliquem o crédito.
O payload JSON não substitui a venda persistida como fonte dos dados financeiros.

- **Pontos:** `floor(amount)`, calculado com `Prisma.Decimal`: R$ 19,90 geram 19
  pontos; R$ 0,99 geram zero pontos, com lançamento auditável. O truncamento ocorre
  por compra. `Customer.points` permanece inteiro. O saldo e um crédito individual
  devem caber no `Int` PostgreSQL, até 2.147.483.647; um excedente mantém o evento
  pendente com erro, sem truncar, perder o crédito ou alterar parcialmente o saldo.
- **Extrato:** cada lançamento guarda loja, cliente, venda, evento, pontos,
  saldo após o crédito e elegibilidade da visita. Há unicidade por loja/venda e
  loja/evento. Chaves compostas impedem vínculos entre lojas. A migração instala
  um trigger que proíbe atualizar ou excluir lançamentos individuais; o ciclo
  existente de exclusão integral de um tenant continua removendo seus próprios dados.
  Eventos e vendas referenciados pelo extrato precisam ser preservados.
- **Cooldown:** somente o progresso das missões é limitado. Uma visita exige
  ausência de compra anterior do mesmo cliente/loja nas últimas 24h, inclusive
  o instante exato de 24h. A próxima visita exige intervalo estritamente maior
  que 24h. Toda compra anterior reinicia essa janela, mesmo que não tenha contado
  como visita. A própria venda e vendas posteriores não bloqueiam a avaliação.
  Empates de horário usam a ordem de IDs como desempate determinístico; uma visita
  já creditada naquele mesmo instante também bloqueia uma segunda visita quando
  outra venda com horário idêntico aparece após o processamento.
- **Missões:** uma visita incrementa `CustomerMission.visits` nas missões `VISITS`
  com status `ACTIVE`, criadas até a compra, e com `expiresAt` nulo ou posterior
  à compra.
  A participação é criada na primeira visita elegível. Registros `COMPLETED`
  permanecem inalterados. `lastVisitAt` guarda o maior horário contabilizado,
  inclusive em processamento fora de ordem. A unicidade é loja/cliente/missão.
  As metas são configuradas pela API de missões descrita abaixo. O dashboard
  B2C projeta o gasto acumulado de `AMOUNT` a partir das vendas. A persistência
  da conclusão automática e a emissão de recompensas permanecem no escopo futuro
  do motor de missões.
- **Retentativas:** falhas deixam `processedAt` nulo e persistem `attempts`,
  `lastError` e `nextAttemptAt`. O backoff começa em cinco segundos e cresce até
  uma hora. Outros eventos disponíveis continuam sendo processados. Reiniciar a
  aplicação retoma os eventos pendentes, incluindo os anteriores à implantação.

A migração `20261103130000_add_loyalty_ledger` preenche o tenant de participações
legadas a partir do cliente e adiciona as constraints. Vínculos entre lojas ou
participações duplicadas fazem a migração falhar de forma atômica, preservando os
dados para correção. Não são inventados contadores históricos para participações
legadas: `visits` começa em zero e estados de conclusão existentes são preservados.

Os aliases exigidos pelo projeto são resolvidos por `scripts/register-aliases.cjs`
nos scripts de inicialização e testes, tanto em `src` com ts-node quanto em `dist`.

#### A.3 API de gestão de missões

O `MissionsModule` oferece as rotas B2B abaixo. Todas exigem JWT Bearer, usam
`JwtAuthGuard` e obtêm a empresa de `@CurrentTenant()`. O service atribui o tenant
nas criações e filtra leituras e atualizações por `tenantId`, inclusive por ID.

| Método | Rota | Resultado |
|---|---|---|
| `POST` | `/missions` | Cria uma missão e retorna `201` |
| `GET` | `/missions` | Lista as missões da loja, das mais recentes para as mais antigas |
| `PATCH` | `/missions/:id/status` | Define `ACTIVE` ou `INACTIVE` e retorna `200` |

Exemplo de criação:

```json
{
  "name": "Volte três vezes",
  "goalType": "VISITS",
  "targetValue": 3,
  "reward": "Um café especial",
  "expiresAt": null
}
```

`name`, `goalType`, `targetValue` e `reward` são obrigatórios. `name` aceita até
120 caracteres e `reward` até 1000; espaços nas extremidades são removidos.
`expiresAt` pode ser omitido ou ser `null` para uma missão permanente; quando
informado, deve ser uma data ISO 8601 válida. O status inicial é `ACTIVE`,
definido no servidor. Nome, tipo, alvo, recompensa e validade não são editáveis
pelo endpoint de status. O contrato atual não inclui paginação.

O enum Prisma `GoalType` permite `VISITS` e `AMOUNT`. O alvo usa `Decimal(12,2)`:
`VISITS` exige inteiro positivo, e `AMOUNT` exige valor positivo em reais com até
duas casas decimais, representando gasto acumulado durante o período da missão.
O máximo é 9.999.999.999,99, e a resposta serializa o decimal como string. Campos
como `tenantId` e `status` não são aceitos na criação. Dados inválidos retornam `400`.

Para desativar uma missão, envie `{"status":"INACTIVE"}`; para ativar, envie
`{"status":"ACTIVE"}`. Repetir a mesma requisição mantém o estado solicitado.
O endpoint valida IDs UUID e não permite atribuir `EXPIRED`. A validade continua
sendo respeitada pela fidelidade independentemente do status. Um ID inexistente
ou pertencente a outra loja retorna o mesmo `404`, sem revelar dados externos.

O Prisma expõe `Mission.name`, mapeado à coluna existente `title`. Descrições
legadas são preservadas na coluna `description`, agora opcional, e não integram
este contrato de criação. O consumidor de fidelidade reconhece missões de visita
permanentes e filtra `VISITS` para não aplicar contadores de visitas a metas
`AMOUNT`. O dashboard B2C calcula o gasto acumulado na leitura. A persistência
da conclusão de metas e a concessão de benefícios serão implementadas no motor
de missões; a API de gestão oferece sua configuração real no banco.

A migração `20261104120000_add_mission_goals` adiciona o enum, o alvo, a validade
opcional e constraints de alvo positivo e inteiro para `VISITS`. Missões legadas
recebem o tipo `VISITS`, correspondente ao comportamento anterior. Como não havia
alvo estruturado, a migração **não inventa valores para registros existentes**.
Se já houver missões, prepare antes uma coluna `targetValue` nullable do tipo
`DECIMAL(12,2)` e preencha os alvos reais de cada missão, filtrando por tenant e ID.
A migração aceita essa coluna previamente preenchida e só então exige `NOT NULL`.
Sem o preenchimento, ela interrompe a aplicação atomicamente, preservando os dados.
Se uma tentativa já tiver sido registrada como falha pelo Prisma, após corrigir
os alvos marque essa tentativa como revertida com
`pnpm exec prisma migrate resolve --rolled-back 20261104120000_add_mission_goals`
antes de executar novamente `migrate deploy`.

#### A.4 Dashboard B2C com autenticação de cliente

`B2cDashboardModule` oferece `GET /b2c/dashboard`. O controller usa o guard
específico `B2cJwtAuthGuard`, conforme o contrato B2C aprovado, e obtém tenant e
cliente de `@CurrentTenant()` e `@CurrentCustomer()`. A estratégia Passport
`b2c-jwt` verifica assinatura HS256 com o `JWT_SECRET` configurado, expiração e
claims obrigatórios:

```json
{
  "sub": "id-do-cliente",
  "tenantId": "id-da-loja",
  "role": "B2C",
  "exp": 1893456000
}
```

O `exp` é um timestamp Unix em segundos. Tokens sem expiração, inválidos,
expirados ou com outro papel retornam `401`. JWTs B2B não autenticam esse endpoint,
e JWTs B2C não autenticam as rotas B2B. O token é enviado como Bearer no header
`Authorization`. A emissão por OTP via WhatsApp será uma etapa posterior; esta
entrega consome tokens já emitidos pelo servidor confiável.

O cliente e a loja são definidos pelo token. Parâmetros de URL como telefone,
`customerId` ou `tenantId` não substituem essa identidade. Cliente inexistente,
excluído ou pertencente a outra loja retorna o mesmo `404`. A resposta usa
`Cache-Control: private, no-store`.

Exemplo de resposta:

```json
{
  "customer": {
    "id": "id-do-cliente",
    "tenantId": "id-da-loja",
    "name": "Ana",
    "phone": "+5511999990000"
  },
  "pointsBalance": 42,
  "missions": [
    {
      "id": "id-da-missao",
      "name": "Volte três vezes",
      "goalType": "VISITS",
      "targetValue": 3,
      "currentValue": 1,
      "remainingValue": 2,
      "isCompleted": false,
      "reward": "Um café especial",
      "expiresAt": null
    },
    {
      "id": "id-da-missao-de-gasto",
      "name": "Acumule R$ 100 em compras",
      "goalType": "AMOUNT",
      "targetValue": "100.00",
      "currentValue": "20.20",
      "remainingValue": "79.80",
      "isCompleted": false,
      "reward": "Um benefício VIP",
      "expiresAt": null
    }
  ]
}
```

O service executa a leitura em transação `RepeatableRead`. O saldo inteiro vem
de `Customer.points`, mantido atomicamente com o extrato imutável. Missões com
status `ACTIVE`, já criadas e sem expiração ou com expiração futura são cruzadas
com `CustomerMission`, sempre com filtros por tenant e cliente. Sem participação,
o progresso de visitas começa em zero. Missões concluídas continuam visíveis
enquanto estiverem ativas e válidas.

Para `AMOUNT`, uma única consulta SQL parametrizada pelo Prisma agrega as vendas
de todos os alvos monetários retornados. São somados os valores positivos de
transações `SALE` do cliente/loja, desde `Mission.createdAt` até o instante da
leitura, respeitando também a validade da missão. Cada missão tem seu próprio
período. O cooldown de visitas não reduz esse gasto. O retorno de `AMOUNT` usa
strings com duas casas decimais; `VISITS` usa números inteiros. Não há carregamento
de todo o histórico de compras na memória nem uma consulta por missão monetária.

`isCompleted` é verdadeiro quando `CustomerMission` já estiver concluída ou o
progresso atingir o alvo. Nesse caso, `remainingValue` é zero. A leitura projeta
esses indicadores sem alterar participações, creditar pontos ou emitir benefícios.
Saldo e visitas refletem a outbox já processada; o gasto acumulado considera as
compras confirmadas e pode aparecer antes de seu crédito de pontos assíncrono.
O front-end pode usar `customer.tenantId` e `customer.id` para identificar a chave
de cache correspondente ao relacionamento exibido.

Não há nova migração nesta entrega: são usados os modelos existentes de clientes,
missões, participações e vendas, com as migrações anteriores aplicadas.

#### Banco e verificação dos módulos de clientes/vendas

A migração `20261103120000_add_customers_and_sales` adiciona CPF, itens, outbox,
idempotência e chaves estrangeiras compostas com `tenantId`. Ela também converte
`Transaction.amount` de `Float` para `Decimal(12,2)`, arredondando valores legados
para duas casas decimais. Registros existentes devem caber nesse intervalo e
referenciar clientes da mesma loja. Clientes/produtos/funcionários referenciados
por vendas ficam protegidos contra exclusão individual para preservar o histórico.

Aplique no banco de destino configurado e gere o cliente antes de executar a API:

```sh
pnpm exec prisma migrate deploy
pnpm prisma:generate
pnpm test
pnpm build
```

Para cadastros legados, normalize os telefones e resolva eventuais colisões de
formatação antes do uso do novo fluxo; a migração não reescreve esses dados.

Os testes HTTP e os testes de regras de fidelidade usam Prisma em memória.
`auth-tenant.e2e-spec.ts` cobre cadastro, rollback, bcrypt, claims B2B, expiração,
decorators e compatibilidade do cadastro anterior. `auth-postgres.integration-spec.ts`
adiciona verificação opcional de atomicidade real e concorrência no PostgreSQL.
`missions.e2e-spec.ts` verifica autenticação, validações, isolamento por empresa e
alteração de status; também contém uma verificação PostgreSQL opcional.
`b2c-dashboard.e2e-spec.ts` verifica JWT B2C, separação B2B/B2C, escopo de cliente,
progresso, expiração, valores decimais e uma consulta PostgreSQL opcional.
As suítes `sales-postgres.integration-spec.ts` e `loyalty-postgres.integration-spec.ts`
verificam concorrência, rollback real, imutabilidade e constraints quando `TEST_DATABASE_URL`
aponta para um banco exclusivo de testes com as migrações aplicadas. Sem essa
variável, a suíte PostgreSQL é explicitamente ignorada e nunca usa `DATABASE_URL`.

#### B. Inventory (Estoque)
- `InventoryService`:
  - `findAll(tenantId)`: Lista os produtos do estabelecimento.
  - `checkExpiringItems(tenantId)`: Varre insumos prestes a vencer em até 7 dias para alertar a IA.
  - `getLowStockItems(tenantId)`: Alerta estoque abaixo da quantidade mínima.

#### C. AiCopilot (Motor da Inteligência Artificial)
- `AiCopilotService`: Conecta à API da OpenAI (`gpt-4o-mini`) utilizando **Function Calling**. Permite que a IA execute funções como `getDailySalesSummary` ou `getLowStockItems` antes de formular a resposta para o proprietário.

#### D. WhatsApp & BullMQ (Mensageria e Filas)
- `WhatsAppProcessor` (BullMQ Consumer): Processa a fila de envio de mensagens no WhatsApp em background, garantindo que o servidor nunca trave.
- `DailyReportScheduler`: Executa os Cron Jobs diários (08h briefing matinal / 22h fechamento noturno).

---

## 4. Fluxo de Dados de uma Requisição

```
[Requisição HTTP / Webhook]
       │
       ▼
┌──────────────┐
│  Controller  │ ◄── Recebe o DTO validado via class-validator
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Guard & Dec. │ ◄── JwtAuthGuard verifica o token; @CurrentTenant() extrai o tenantId
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Service    │ ◄── Processa a regra de negócio e aciona a IA / Fila BullMQ se necessário
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Prisma Service│ ◄── Executa a query PostgreSQL filtrando por tenantId
└──────┬───────┘
       │
       ▼
[Resposta JSON Tipada]
```
