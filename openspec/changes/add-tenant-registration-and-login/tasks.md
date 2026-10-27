# Tasks

## 1. Fundamentos de autenticação

- [x] 1.1 Adicionar uma biblioteca de hashing sem dependências nativas e configurar JWT com `JWT_SECRET` e `JWT_EXPIRATION`; verificar instalação e inicialização com configurações válidas e erro explícito quando faltar segredo.
- [x] 1.2 Implementar estratégia JWT e serviço de hashing/comparação de senha com claims `sub`, `tenantId` e `role`; verificar com testes unitários que tokens válidos são aceitos, tokens inválidos/expirados são rejeitados e senhas são comparadas por hash.

## 2. Cadastro da empresa e proprietário

- [x] 2.1 Criar DTOs e `POST /tenants` com validação de campos, valores controlados pelo servidor e criação transacional de Tenant e proprietário; verificar que cadastro válido retorna HTTP 201 e que slug/e-mail duplicados retornam HTTP 409 sem registros parciais.
- [x] 2.2 Adicionar testes para campos inválidos, atomicidade, papel OWNER padrão e ausência de senha/hash nas respostas; executar os testes do módulo de tenants.

## 3. Login

- [x] 3.1 Criar DTO de login e `POST /auth/login`, validando e-mail e senha e retornando JWT com dados públicos; verificar HTTP 200 para credenciais válidas e HTTP 401 uniforme para usuário inexistente e senha incorreta.
- [x] 3.2 Adicionar testes que confirmem claims de usuário/tenant/papel no token e garantam que a resposta não exponha hash de senha; executar os testes do módulo de autenticação.

## 4. Consulta protegida da empresa

- [x] 4.1 Implementar `GET /tenants/me` com guard JWT e seleção exclusiva dos campos públicos do tenant identificado pelo token; verificar HTTP 200 para tenant existente e HTTP 401 sem token, token inválido ou expirado.
- [x] 4.2 Testar que a consulta nunca usa um `tenantId` enviado pelo cliente, não expõe campos de autenticação e não retorna outro tenant quando o tenant do token não existe; executar os testes do módulo de tenants.

## 5. Documentação e integração

- [x] 5.1 Atualizar `PROJECT_GUIDE.md` com rotas, corpos esperados, resposta de autenticação e variáveis JWT necessárias; verificar que a documentação corresponde aos DTOs e controllers implementados.
- [x] 5.2 Executar `pnpm build` e a suíte de testes; verificar que os três endpoints estão registrados e que o fluxo cadastro → login → `GET /tenants/me` funciona em teste integrado.
