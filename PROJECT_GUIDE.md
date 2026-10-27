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
- `AuthService`: Valida credenciais, verifica senhas armazenadas com hash `bcryptjs` e emite JWT com `sub`, `tenantId` e `role`.
- `TenantsService`: Cadastra empresa e proprietário na mesma operação e consulta os dados públicos da empresa autenticada.
- `JwtStrategy` e `JwtAuthGuard`: Validam o token Bearer e impedem o acesso ao GET de empresa sem uma identidade válida.

#### Endpoints disponíveis

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `POST` | `/tenants` | Público | Cadastra uma empresa e seu proprietário |
| `POST` | `/auth/login` | Público | Autentica por e-mail e senha e retorna um JWT |
| `GET` | `/tenants/me` | JWT Bearer | Retorna somente a empresa associada ao token |

Exemplo de cadastro:

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

Configure `JWT_SECRET` com um segredo forte e exclusivo fora do controle de versão. `JWT_EXPIRATION` aceita durações positivas em segundos (`s`), minutos (`m`), horas (`h`) ou dias (`d`), por exemplo `7d`; se omitida, o padrão é `7d`. O servidor falha ao iniciar a configuração de autenticação se `JWT_SECRET` estiver ausente.

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
