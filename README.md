# HOTFIX v2.0.1

Corrige o loop de redirecionamento de `/admin` e `/host` no Cloudflare Workers Static Assets usando `html_handling: "none"`.

# Quiz SIPAT 2026 — Cloudflare v2.0

Versão online do Quiz SIPAT 2026 Automazoom, preparada para GitHub + Cloudflare Workers.

## O que esta versão mantém

- Até 31 jogadores e 31 avatares exclusivos.
- Host/TV, celulares e painel Admin separados.
- 1 a 50 perguntas editáveis.
- Tempo configurável, bots, kick/reentrada, ranking, troféus, confete e áudios.
- Sala única, sem código.
- Atualização em tempo real via WebSocket.
- Estado da partida e perguntas persistidos em Durable Object.

## Novo: login e vários administradores

- `/admin` exige usuário e senha.
- O primeiro usuário é criado a partir dos Secrets do Cloudflare.
- Dentro do painel, abra **Usuários Admin** para criar outros usuários.
- Todos possuem as mesmas permissões.
- É possível trocar senha, ativar/desativar e excluir contas.
- O sistema impede desativar/excluir o último administrador ativo.
- Senhas são armazenadas como hash PBKDF2 + salt; não ficam salvas em texto puro.
- A sessão usa cookie HttpOnly assinado por HMAC.

## 1. Instalar localmente

Requer Node.js 20+.

```bash
npm install
```

Crie um arquivo `.dev.vars` apenas para desenvolvimento local:

```env
SESSION_SECRET=troque-por-uma-chave-longa-e-aleatoria
BOOTSTRAP_ADMIN_USER=admin
BOOTSTRAP_ADMIN_PASSWORD=troque-esta-senha
```

Depois:

```bash
npm run dev
```

Abra:

- Jogadores: `http://localhost:8787/`
- Host: `http://localhost:8787/host`
- Admin: `http://localhost:8787/admin`

## 2. Criar o repositório no GitHub

Crie um repositório, por exemplo `quiz-sipat-2026`, e envie todo o conteúdo desta pasta.

Exemplo:

```bash
git init
git add .
git commit -m "Quiz SIPAT 2026 Cloudflare v2.0"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

O arquivo `.dev.vars` já está no `.gitignore` e **não deve ser enviado ao GitHub**.

## 3. Configurar os Secrets no Cloudflare

Depois de autenticar o Wrangler:

```bash
npx wrangler login
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_USER
npx wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
```

Use uma `SESSION_SECRET` longa e aleatória e uma senha forte para o primeiro admin.

## 4. Publicar

```bash
npm run deploy
```

O Worker criará um Durable Object SQLite chamado `QuizRoom` pela migration do `wrangler.jsonc`.

## 5. Conectar o GitHub ao Cloudflare

No Cloudflare Dashboard:

1. **Workers & Pages** → **Create application**.
2. Escolha **Import a repository**.
3. Autorize o GitHub e selecione o repositório.
4. Use `npm install`/instalação padrão e o comando de deploy do projeto (`npx wrangler deploy`) quando solicitado.
5. Configure os três Secrets no Worker antes do primeiro uso do Admin.

A integração do Cloudflare com GitHub pode publicar novas versões automaticamente após pushes na branch configurada.

## Observações importantes

- O primeiro administrador é criado somente se ainda não existir nenhuma conta no armazenamento.
- Depois disso, novos administradores devem ser criados pelo próprio painel.
- Se você alterar `BOOTSTRAP_ADMIN_PASSWORD` depois, isso não troca a senha de uma conta já criada; use **Usuários Admin → Nova senha**.
- Os arquivos de áudio são publicados como assets do Worker. Garanta que a empresa tenha direito/licença para disponibilizar publicamente as músicas usadas.


## QR Code no Host (v2.0.2)
A tela `/host` exibe um QR Code para `https://quiz-sipat-2026.automazoom.workers.dev`. No lobby ele aparece em destaque e durante o quiz fica reduzido no canto. O botão **Mostrar/Ocultar QR** no cabeçalho controla a exibição.


## v2.0.5
- QR Code pequeno aparece apenas em contagem, pergunta e carregamento, evitando cobrir o destaque de mais rápido/resultados.
- Após o resultado final, o Admin mostra **Finalizar sessão**. Esse botão remove todos os participantes e pontuações e volta o Host ao lobby vazio, preservando perguntas, configurações e usuários administrativos.
