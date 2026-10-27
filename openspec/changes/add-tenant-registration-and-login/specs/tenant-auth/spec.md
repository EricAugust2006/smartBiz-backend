# Spec Delta

## Purpose

Permite que uma empresa crie sua conta com um usuário proprietário, autentique-se e consulte com segurança os próprios dados no SmartBiz.

## ADDED Requirements

### Requirement: Cadastro cria uma empresa e seu proprietário
O sistema MUST permitir que um visitante cadastre uma empresa e seu usuário proprietário em uma única operação, sem armazenar nem retornar a senha em texto puro.

#### Scenario: Cadastro válido
- **WHEN** o visitante envia nome e slug da empresa, nome e e-mail do proprietário, senha e, opcionalmente, telefone de WhatsApp
- **THEN** o sistema cria a empresa e o usuário proprietário associados, aplica os valores padrão do modelo quando cabível e retorna HTTP 201 sem incluir senha ou hash

#### Scenario: Slug ou e-mail já utilizado
- **WHEN** o visitante tenta cadastrar uma empresa com slug ou e-mail já existente
- **THEN** o sistema retorna HTTP 409 e não deixa empresa ou usuário parcialmente criados

#### Scenario: Dados de cadastro inválidos
- **WHEN** o visitante envia campos obrigatórios ausentes ou inválidos
- **THEN** o sistema rejeita a requisição com erro de validação e não cria registros

### Requirement: Login autentica usuário por e-mail e senha
O sistema MUST validar as credenciais e emitir um token de acesso que identifique o usuário autenticado e seu tenant.

#### Scenario: Credenciais válidas
- **WHEN** o usuário envia e-mail e senha corretos
- **THEN** o sistema retorna HTTP 200 com um token JWT de acesso e dados públicos do usuário e da empresa, sem incluir a senha ou seu hash

#### Scenario: Credenciais inválidas
- **WHEN** o usuário envia um e-mail inexistente ou uma senha incorreta
- **THEN** o sistema retorna HTTP 401 sem revelar qual credencial falhou

### Requirement: Consulta da empresa exige autenticação
O sistema MUST exigir um token de acesso válido para consultar dados da empresa, e MUST limitar a resposta ao tenant associado ao token.

#### Scenario: Usuário autenticado consulta sua empresa
- **WHEN** o usuário envia um token válido ao consultar os dados da empresa
- **THEN** o sistema retorna HTTP 200 com os dados públicos do tenant do token, sem retornar credenciais ou dados de autenticação

#### Scenario: Requisição sem token válido
- **WHEN** o usuário consulta os dados da empresa sem token, com token inválido ou expirado
- **THEN** o sistema retorna HTTP 401

#### Scenario: Tenant do token não existe mais
- **WHEN** o token é válido, mas o tenant associado já não existe
- **THEN** o sistema não retorna dados de outro tenant e responde com erro apropriado de recurso não encontrado
