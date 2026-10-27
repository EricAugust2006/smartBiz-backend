# Proposal

## Why

O backend já modela empresas (`Tenant`) e seus usuários (`User`), mas ainda não oferece uma forma de cadastrar uma empresa e seu proprietário nem de autenticar esse proprietário. Esses fluxos são necessários para que uma empresa possa começar a usar a aplicação e para que os endpoints privados identifiquem seu tenant.

## What Changes

- Adicionar endpoint para cadastrar uma empresa e seu usuário proprietário.
- Adicionar endpoint de login que valide as credenciais e emita um token JWT.
- Adicionar endpoint autenticado para consultar os dados da empresa associada ao usuário do token.
- Validar os dados de entrada e evitar retornar hashes de senha ou outros dados de autenticação.

## Capabilities

### New Capabilities
- `tenant-auth`: Cadastro da empresa com proprietário, autenticação por credenciais e leitura protegida dos dados da empresa autenticada.

### Modified Capabilities
- Nenhuma.

## Impact

- Módulos NestJS `auth` e `tenants`, atualmente sem controllers ou serviços funcionais.
- Modelos Prisma existentes `Tenant` e `User`; a implementação deve respeitar o relacionamento atual, `Tenant.slug` único e `User.email` único.
- API HTTP: novos endpoints de cadastro, login e consulta autenticada da empresa.
- Configuração de autenticação JWT e hashing de senha; considerar as dependências presentes e acrescentar apenas as que forem necessárias.
