# Sistema de Barbearias — Multi-tenant

Sistema de gestão para barbearias (agenda, frente de caixa, estoque, financeiro,
comissões) com suporte a múltiplas barbearias na mesma instalação, cada uma
isolada por subdomínio.

## O que mudou em relação à versão anterior

- **Multi-tenant**: cada barbearia agora é um *tenant* identificado por um
  `slug` único, isolado em todas as tabelas do banco. Não há mais uma única
  barbearia fixa — qualquer pessoa pode cadastrar a sua pela tela `/signup.html`.
- **Senhas com hash**: senhas nunca são armazenadas em texto puro. Usamos
  `bcryptjs` (sem dependência nativa, para facilitar deploy).
- **Banco relacional de verdade**: trocamos o padrão "uma linha = um JSON
  solto" por tabelas normalizadas (`better-sqlite3`), com índices nos campos
  mais consultados (tenant + data, tenant + status, etc).
- **Sessões persistidas**: sessões de login ficam no banco (tabela `sessions`),
  não em memória — sobrevivem a um restart do processo.
- **Rate limiting de login**: 5 tentativas falhas na mesma janela de 15
  minutos (por e-mail + IP) bloqueiam novas tentativas temporariamente.
- **Fila de notificações**: confirmação e cancelamento de agendamento geram
  uma notificação na tabela `notifications`, processada a cada 30 segundos.
  Por padrão, o envio só **loga no console** (provider "console") — troque
  isso por um provedor real (SMTP, Resend, SendGrid) em `notifications.js`,
  na função `sendViaProvider`, quando for para produção.
- **Login com cancelamento de agendamento e quitação de conta a pagar**,
  ações que a versão anterior não tinha na interface.

## Instalação

```bash
npm install
npm run seed:demo   # cria a barbearia de demonstração "barbearia-modelo"
npm start
```

O `npm install` precisa de acesso à internet (não consegui rodar isso no
ambiente em que gerei os arquivos, então valide localmente). As dependências
são apenas duas: `better-sqlite3` e `bcryptjs`.

## Como o sistema identifica qual barbearia está sendo acessada

### Em produção (subdomínio real)

Configure seu servidor (nginx, Caddy, etc.) para apontar `*.seudominio.com`
para esta aplicação. O backend lê o subdomínio direto do header `Host`:

```
barbearia-modelo.seudominio.com  →  tenant "barbearia-modelo"
outra-barbearia.seudominio.com   →  tenant "outra-barbearia"
seudominio.com                   →  área de cadastro/marketing (sem tenant)
```

Não precisa de nenhuma configuração adicional no Node — é o `tenant.js`
(`extractSlugFromHost`) que faz essa leitura.

### Em desenvolvimento local

Subdomínios não resolvem em `localhost` sem truques de DNS. Por isso, o
sistema aceita dois fallbacks, só usados quando o host é `localhost` ou
`127.0.0.1`:

```
http://localhost:3000/?tenant=barbearia-modelo
```

ou enviando o header `X-Tenant-Slug: barbearia-modelo` nas chamadas de API.
O `tenant-client.js` no frontend já propaga o `?tenant=` automaticamente
entre as páginas e injeta o header nas chamadas — você só precisa acessar
com o parâmetro uma vez.

Alternativa, se preferir testar como em produção: edite seu arquivo `hosts`
(`/etc/hosts` no Linux/Mac, `C:\Windows\System32\drivers\etc\hosts` no
Windows) e adicione:

```
127.0.0.1   barbearia-modelo.localhost
```

Depois acesse `http://barbearia-modelo.localhost:3000` diretamente, sem
parâmetro nenhum.

## Estrutura de arquivos

```
server.js              servidor HTTP e rotas da API
db.js                  acesso ao banco (toda função exige tenantId)
auth.js                hash de senha, sessões, permissões, rate limiting
tenant.js               resolução de tenant por subdomínio/header/query
notifications.js        geração e envio (fila) de notificações
schema.sql              schema completo do banco
scripts/seed-demo.js    popula uma barbearia de demonstração
public/                 frontend (site público, login, cadastro, painel)
```

## Credenciais de demonstração

Após rodar `npm run seed:demo`:

| Papel     | E-mail                          | Senha         |
|-----------|----------------------------------|---------------|
| Admin     | admin@barbeariamodelo.com       | Admin@123     |
| Gerente   | gerente@barbeariamodelo.com     | Gerente@123   |
| Barbeiro  | barbeiro@barbeariamodelo.com    | Barbeiro@123  |

## Próximos passos sugeridos (não incluídos nesta rodada)

- Envio real de e-mail/SMS (trocar o provider "console" em `notifications.js`).
- Cobrança/planos (a tabela `tenants` já tem campos `plan` e `status`, mas
  não há integração com gateway de pagamento).
- Lembrete automático de agendamento (a função `buildReminderMessage` já
  existe em `notifications.js`, mas falta um job agendado que a dispare
  N horas antes do horário marcado).
- Página de "esqueci minha senha".
