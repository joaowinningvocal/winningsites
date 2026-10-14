# Winning Sites — rascunhos + ferramenta de revisão

Um app só (Node + Express) que serve os novos sites do **Winning Ranch** e do **Winning Realty** e uma tela de revisão onde dá pra marcar o site com comentários, setas e destaques.

| Endereço | O que é |
|---|---|
| `/review/` | Ferramenta de revisão (o link pra mandar pro chefe) |
| `/ranch/` | Rascunho do novo Winning Ranch |
| `/ranch/stalls.html` | Mapa interativo das baias (preços, fotos, disponibilidade, reserva) |
| `/ranch/portal/` | Portal do dono: login, cavalos, fotos e vídeos postados pela equipe |
| `/ranch/admin/` | App da equipe: postar updates, reservas, cavalos, pessoas, baias e preços |
| `/realty/` | Espaço do Winning Realty (por enquanto só um placeholder) |

## Rodar no computador

```bash
npm install
npm start
# abre http://localhost:3000/review/
```

Os comentários ficam em `data/review.json`.

## Subir no Railway

1. Suba esta pasta num repositório do GitHub e crie um serviço no Railway a partir dele. Ele detecta o Node e roda `npm start`.
2. Em **Volumes**, adicione um volume montado em `/data`.
3. Em **Variables**, configure:
   - `DATA_DIR=/data` (obrigatório: sem isso os comentários somem a cada deploy)
   - `REVIEW_PASSWORD=uma-senha` (recomendado: protege tudo com login; qualquer usuário + essa senha)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `ADMIN_NAME` (cria o primeiro login da equipe no app `/ranch/admin/`. Depois de criado, dá pra tirar a senha das variáveis)
   - `CONTACT_WEBHOOK_URL=https://...` (opcional: cada mensagem do formulário de contato também é enviada pra essa URL, ex. integrator.io ou Zapier)
   - `BOOKING_WEBHOOK_URL=https://...` (opcional: cada pedido de reserva é enviado pra essa URL. Se não tiver, usa o `CONTACT_WEBHOOK_URL`)
   - `SEED_DEMO=1` (opcional, só pra revisão: cria o dono de teste `demo@winningranch.com` / `demo-ranch` com o cavalo Dakota e alguns updates. Tire antes de ir ao ar)
4. Gere um domínio em **Settings → Networking** e mande o link `https://SEU-DOMINIO/review/` pro chefe.

O `railway.json` já configura o health check em `/healthz`.

## Como usar a revisão

- **Abas no topo** trocam de site; o seletor ao lado troca de página (também dá pra navegar clicando nos links do próprio site).
- **Barra de ferramentas embaixo:**
  - **Navegar (V):** usa o site normalmente
  - **Comentar (C):** clica em qualquer ponto e escreve
  - **Seta (A):** arrasta de onde sai até o que quer apontar
  - **Destacar (B):** arrasta uma caixa em volta de uma área
  - Ícones de **desktop / tablet / celular** mudam a largura da prévia
  - O **olho** mostra ou esconde as marcações
- **Esc** cancela o que estiver fazendo. **Ctrl+Enter** salva o comentário.
- Na lista da direita: clicar num comentário leva até ele no site. Dá pra **Responder**, **Resolver** e **Excluir**.
- O endereço da página guarda o comentário selecionado (`#site=ranch&page=/&c=...`), então dá pra mandar o link de um comentário específico.
- **EN/PT** no topo troca o idioma da ferramenta.

As marcações ficam presas ao elemento do site (não a uma posição fixa da tela), então continuam no lugar certo quando muda a largura ou o texto ao redor.

### Aplicar as mudanças com o Claude

**Exportar → Copiar comentários abertos** copia tudo em Markdown (página, número, o que foi marcado, o seletor do elemento e o texto). É só colar numa conversa com o Claude junto com os arquivos do site. Depois de aplicar, marque os comentários como resolvidos.

## Estrutura

```
server.js            servidor, API de comentários e formulário de contato
routes/ranch.js      API do rancho: baias, reservas, login, portal, app da equipe
lib/                 store JSON, autenticação, posições das baias no mapa
sites.config.json    lista de sites e páginas que aparecem na revisão
review/              ferramenta de revisão (index.html, review.js, review.css)
review/overlay.js    script injetado nas páginas; só funciona dentro de /review
sites/ranch/         site do Winning Ranch (HTML/CSS/JS estático)
sites/realty/        site do Winning Realty
```

**Página nova:** crie o `.html` em `sites/<site>/` e adicione em `sites.config.json`.
**Site novo:** crie `sites/<id>/index.html` e adicione um bloco em `sites.config.json`. Ele aparece como nova aba.

O servidor injeta o `overlay.js` em todo HTML servido, mas o script não faz nada fora da ferramenta de revisão. Visitante comum não vê nada.

## Winning Ranch: o que falta

**Fotos.** Coloque estes arquivos em `sites/ranch/img/photos/` e eles aparecem sozinhos no lugar dos espaços "Add photo":

| Arquivo | Onde aparece |
|---|---|
| `hero.jpg` | Topo da home (substitui o painel preto com o cavalo) |
| `care.jpg` | "Why owners choose Winning Ranch" |
| `aisle.jpg` | Galeria: corredor das baias |
| `stall.jpg` | Galeria: dentro de uma baia |
| `rv.jpg` | Galeria: área de trailer e RV |

**Informações** marcadas em vermelho tracejado no site (procure `class="tbd"` no HTML):
- preço mensal (agora se coloca no app da equipe, em Baias e preços)
- tamanho das baias
- horário de visita
- o que o full care inclui

**Ainda apontando pra Wix:** os 4 formulários de waiver (`waivers.html`). A reserva agora é pelo mapa.

**Formulário de contato:** salva em `data/review.json` e pode ser lido em `/api/contacts` (protegido pela senha). Configure `CONTACT_WEBHOOK_URL` pra receber cada mensagem em outro lugar.

**Antes de ir ao ar no domínio real:**
- troque `og:image` para o endereço completo (ex. `https://www.winningranch.com/img/og-image.jpg`)
- remova a senha se este mesmo serviço for servir o site público

## Winning Ranch: mapa, reservas, portal do dono e app da equipe

### Mapa das baias (`stalls.html`)
O visitante escolhe as datas e o mapa mostra quais baias estão livres. Passando o mouse numa baia aparece um card animado com a foto (ou um zoom do mapa enquanto não tiver foto), status e preço. Clicando, abre a ficha da baia com fotos, preço por noite e por mês, tamanho e o botão de adicionar à reserva. Dá pra juntar várias baias e mandar um pedido só. No celular o mapa rola de lado e o toque abre a ficha. Embaixo do mapa tem a lista de todas as baias.

O pedido fica **pendente** e já segura as baias. A equipe confirma ou recusa no app. **Ainda não tem pagamento online:** a Jenna confirma e cobra por telefone. O próximo passo natural é ligar o Stripe Checkout na confirmação.

As posições das baias no mapa estão em `lib/ranch-seed.js`, em pixels da imagem `img/ranch-map.jpg` (1448 x 1086). Se trocarem a arte do mapa, ajuste esses números. As áreas sem reserva (arenas, round pens, etc.) estão no topo de `js/stalls.js`.

### Portal do dono (`/ranch/portal/`)
O dono loga e vê os cavalos dele, com o feed de fotos e vídeos que a equipe posta, agrupado por dia. Funciona como app no celular: dá pra "Adicionar à tela de início" (tem manifest e ícones).

Não tem cadastro aberto. A equipe cria a pessoa no app e recebe um **link de acesso** pra mandar por SMS ou email (o sistema não envia email sozinho). A pessoa abre o link, cria a senha e já entra. O mesmo botão gera um link novo se ela esquecer a senha.

### App da equipe (`/ranch/admin/`)
Feito pra usar no celular, no meio do rancho:
- **Postar update:** escolhe o cavalo, tira foto ou vídeo e posta. O dono vê na hora.
- **Reservas:** pedidos que chegaram pelo mapa, com botões de confirmar, recusar, concluir e cancelar, além de uma nota interna.
- **Cavalos:** cadastro, dono e baia. Um cavalo numa baia deixa ela ocupada no mapa.
- **Pessoas:** donos e equipe, com os links de acesso.
- **Baias e preços:** preço por noite e por mês, tamanho, status, descrição e fotos de cada baia (com opção de aplicar pra todas do mesmo grupo), além dos preços de full care e trailer/RV.

### Onde ficam os dados
Tudo fica em `DATA_DIR`: `ranch.json` (baias, reservas, pessoas, cavalos, updates) e `uploads/` (fotos das baias são públicas; fotos e vídeos dos cavalos só abrem para o dono e a equipe). Por isso o Volume no Railway é obrigatório.

### Limitações desta versão
- Sem pagamento online e sem envio automático de email/SMS.
- Vídeos ficam no Volume do Railway. Pra muitos vídeos, o certo é migrar para S3 ou Cloudflare R2.
- Vídeo `.mov` de iPhone (HEVC) toca no Safari, mas pode não tocar no Chrome do computador. Fotos HEIC idem. Converter na hora do upload fica pra uma próxima versão.
- Os dados ficam em um arquivo JSON. Quando virar app com muitos usuários, migrar para Postgres (o código de rotas já está separado em `routes/ranch.js`).

## Limitações conhecidas (ferramenta de revisão)

- Marcações feitas em elementos fixos na tela (o cabeçalho que acompanha a rolagem, a barra de botões do celular) ficam na posição da página, não acompanham o elemento quando rola.
- Uma seta ou caixa desenhada sobre áreas vazias fica presa ao bloco inteiro da seção. Se o layout mudar muito entre desktop e celular, ela pode cair em outro ponto. Pins em textos, botões e imagens são os mais precisos.
- Os comentários ficam num arquivo JSON. É ótimo pra uma equipe pequena revisando, mas não é pensado pra centenas de pessoas ao mesmo tempo.

Fontes Cinzel e Barlow: SIL Open Font License, ver `sites/ranch/fonts/`.
