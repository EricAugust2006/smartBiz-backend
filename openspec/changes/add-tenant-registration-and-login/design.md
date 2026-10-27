# Design

## Context

Os módulos `auth` e `tenants` atualmente não possuem controllers nem serviços. O schema Prisma já contém `Tenant` e `User`, com `Tenant.slug` e `User.email` únicos, relação obrigatória do usuário com a empresa e `Role.OWNER` como papel padrão. A aplicação já habilita `ValidationPipe`, e o `.env.example` declara `JWT_SECRET` e `JWT_EXPIRATION`. Ver `proposal.md` e `specs/tenant-auth/spec.md`.

## Goals / Non-Goals

**Goals:**
- Implementar os três contratos HTTP da capability `tenant-auth`.
- Garantir isolamento por tenant a partir da identidade contida no token, sem aceitar `tenantId` arbitrário no GET.
- Manter credenciais fora das respostas e armazenar somente senha com hash.

**Non-Goals:**
- Implementar CRUD de usuários, recuperação de senha, confirmação de e-mail ou controle de permissões administrativas.
- Implementar funcionalidades de clientes, estoque, missões ou WhatsApp.

## Decisions

- **Separar as rotas por responsabilidade:** `POST /tenants` cadastra empresa e proprietário; `POST /auth/login` autentica; `GET /tenants/me` consulta o tenant da identidade autenticada. O GET requer `Authorization: Bearer <token>`. Listagem pública de empresas não será oferecida.
- **Criar empresa e proprietário na mesma transação Prisma:** calcular o hash antes da transação e persistir os dois registros em uma única transação. Isso evita deixar uma empresa sem proprietário ou um proprietário sem empresa. Tratar violações de unicidade de slug/e-mail como HTTP 409 sem expor detalhes internos.
- **Usar os serviços de autenticação já disponíveis no ecossistema:** `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` já constam nas dependências. Configurar `JwtModule` com `JWT_SECRET` e `JWT_EXPIRATION`, implementar estratégia JWT, e usar `bcryptjs` para hash e comparação sem exigir dependência nativa específica da plataforma.
- **Usar DTOs validados pelo pipe global:** exigir `name`, `slug`, nome do proprietário, e-mail e senha no cadastro; aceitar `whatsappNumber` como opcional. No login, exigir e-mail e senha. Não aceitar `plan`, `role`, `tenantId` ou hash de senha vindos do cliente para criação.
- **Definir respostas sem segredos:** cadastro retorna dados públicos do tenant e do proprietário; login retorna `access_token` JWT e dados públicos correspondentes. Os claims do token devem identificar `sub` (ID do usuário), `tenantId` e `role`, e o GET deve selecionar apenas campos públicos do tenant.
- **Retornar erro de autenticação uniforme:** credenciais ausentes/inválidas resultam em HTTP 401 sem distinguir e-mail inexistente de senha incorreta. Token ausente, inválido ou expirado também resulta em HTTP 401.

## Risks / Trade-offs

- [Segredo JWT ausente ou fraco compromete a autenticação] → exigir `JWT_SECRET` configurado e não fornecer segredo padrão em produção; documentar `JWT_EXPIRATION` e validar a configuração ao iniciar o módulo.
- [bcrypt limita a taxa de verificação de senhas] → escolher custo seguro compatível com o ambiente e evitar divulgar se uma conta existe; proteção contra abuso por rate limit fica fora desta entrega.
- [Nomes de empresa e slugs podem diferir em normalização] → preservar o slug recebido conforme validação e unicidade do banco; regras de normalização precisam ser consistentes entre criação e clientes.
- [Schema exige slug único e e-mail globalmente único] → mapear violações de unicidade para conflito HTTP sem retornar valores internos ou mensagens do banco.

## Migration Plan

1. Confirmar `JWT_SECRET`, `JWT_EXPIRATION` e `DATABASE_URL` no ambiente de execução; não versionar o arquivo `.env`.
2. Adicionar a dependência de hashing escolhida e gerar novamente o Prisma Client conforme necessário.
3. Como o schema atual já contém os campos necessários, não se prevê alteração de schema nem nova migração para esta capability.
4. Implantar os módulos e rotas, validar com testes e fazer smoke test de cadastro, login e `GET /tenants/me`.
5. Rollback: reverter a versão da aplicação; não é necessário reverter dados ou migrações de schema desta mudança.
