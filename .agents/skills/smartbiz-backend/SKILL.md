---
name: smartbiz-backend
description: Crie ou altere código NestJS e Prisma exclusivamente no back-end SmartBiz AI em C:/Users/erica/Desktop/smartBiz/smartbiz-ai-backend, com aliases fixos e isolamento por tenant.
---

# SmartBiz Backend

Atue como engenheiro de software sênior especialista no back-end SmartBiz AI, estritamente em NestJS com Prisma. Estas regras são exclusivas deste projeto.

## Diretório obrigatório

- Raiz do projeto: `C:\Users\erica\Desktop\smartBiz\smartbiz-ai-backend`.
- Gere todos os Controllers, Services, Modules, DTOs e demais arquivos considerando essa raiz e a estrutura existente sob ela. Não trate o diretório atual do chat como raiz do projeto e não gere código de front-end.
- Se a raiz não estiver acessível, informe o impedimento; não use outro projeto como substituto.

## Interação obrigatória

Antes de gerar ou editar qualquer código para um módulo ou funcionalidade solicitada, faça de uma a duas perguntas curtas sobre requisitos relevantes e aguarde a resposta. Não entregue código, nem mesmo um esqueleto, antes da resposta. Considere respostas já fornecidas para o mesmo escopo; não repita perguntas resolvidas.

Escolha perguntas que mudem a implementação: paginação, campos opcionais, roles autorizadas, regras de negócio ou contrato da API. Se o escopo mudar e introduzir requisitos essenciais desconhecidos, esclareça-os antes de implementar a nova parte.

## Regras compartilhadas

- Proíba `any`, inclusive em casts e tipos genéricos. Use tipos explícitos, interfaces ou tipos gerados pelo Prisma Client; para dados desconhecidos, use `unknown` com validação antes do uso.
- Prefira early returns: valide condições negativas primeiro e interrompa o fluxo cedo, evitando aninhamento profundo de `if/else`.
- Use os aliases estáticos abaixo. Não procure caminhos alternativos nem os substitua por imports relativos. Consulte o código existente apenas para contratos, schema Prisma e padrões relevantes à tarefa.
- Não invente regras de negócio, permissões de roles ou campos do schema. Use o contexto disponível e as respostas do usuário.

## Back-end: NestJS e Prisma

### Imports obrigatórios quando aplicáveis ao arquivo

```ts
import { PrismaService } from '@database/prisma.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
```

### Controllers

- Aplique sempre `@UseGuards(JwtAuthGuard)`, preferencialmente no controller para proteger todas as rotas.
- Inclua sempre `@CurrentTenant() tenantId: string` nos parâmetros de cada handler de rota e repasse o tenant ao service.
- Mantenha controllers enxutos: receba a requisição, use DTOs validados e delegue ao service. Não coloque queries Prisma nem lógica de negócio no controller.
- Obtenha o tenant pelo decorator autenticado; não confie em `tenantId` enviado por body, query string ou parâmetro de URL como fonte de autorização.

### Services e isolamento por tenant

- Injete `PrismaService` no construtor. Injete também os demais serviços e repositórios necessários; não os instancie manualmente.
- O primeiro parâmetro de todo método de negócio deve ser `tenantId: string`.
- Mantenha lógica de negócio, autorização de negócio e acesso ao banco no service, preservando as responsabilidades e a injeção de dependências.
- Toda leitura, alteração ou exclusão de dados de um estabelecimento deve incluir `tenantId` no filtro Prisma, inclusive consultas por ID, listagens, contagens, operações em lote e queries dentro de transações. Combine os filtros necessários, como `where: { tenantId, id }`; nunca consulte ou altere apenas por `id`.
- Garanta que filtros fornecidos pelo cliente não sobrescrevam o `tenantId` autenticado.
- Em criações, atribua o `tenantId` autenticado nos dados persistidos; não aceite que o payload escolha outro tenant.
- Valide relações e operações aninhadas para que referências pertençam ao mesmo tenant. Use operações e filtros compatíveis com o schema e os tipos Prisma existentes; não remova o isolamento para contornar erro de tipagem.
- Retorne `NotFoundException` quando o recurso não existir no tenant atual, inclusive quando o ID pertencer a outro tenant, sem revelar sua existência. Use `BadRequestException` para violações de regras de negócio e outras exceções semânticas do NestJS conforme o caso.

### DTOs

- Use decoradores de `class-validator` em todas as propriedades, compatíveis com o tipo e as restrições do campo, como `@IsString()`, `@IsInt()` e `@IsOptional()` para campos opcionais.
- Use `class-transformer` apenas quando necessário para conversões explícitas ou objetos aninhados, com `@Type()` ou `@Transform()` conforme o campo. Para DTOs aninhados, combine a transformação com `@ValidateNested()` e, em arrays, a validação de cada item. Evite conversões que alterem silenciosamente o significado do payload.
- Preserve a validação em runtime pelo mecanismo de validação NestJS do projeto; tipos TypeScript sozinhos não validam payloads.
- Não exponha campos de controle de tenant como editáveis pelo cliente.

## Verificação e entrega

Revise as mudanças para confirmar a ausência de `any`, os aliases fixos, a separação controller/service, os guards, os DTOs validados e o isolamento de tenant em todas as operações afetadas.

Execute verificações existentes pertinentes à mudança quando disponíveis. Para alterações de acesso a dados, verifique especialmente que um tenant não consegue listar, ler, alterar, excluir ou associar recursos de outro tenant. Informe o que foi alterado, o que foi validado e qualquer limitação real, sem afirmar testes não executados.
