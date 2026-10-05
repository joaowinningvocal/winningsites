# Winning Sites — rascunhos + ferramenta de revisão

Um app só (Node + Express) que serve os novos sites do **Winning Ranch** e do **Winning Realty** e uma tela de revisão onde dá pra marcar o site com comentários, setas e destaques.

| Endereço | O que é |
|---|---|
| `/review/` | Ferramenta de revisão (o link pra mandar pro chefe) |
| `/ranch/` | Rascunho do novo Winning Ranch |
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
   - `CONTACT_WEBHOOK_URL=https://...` (opcional: cada mensagem do formulário de contato também é enviada pra essa URL, ex. integrator.io ou Zapier)
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
- preço mensal
- número de baias e tamanho
- arena / turnout
- horário de visita
- o que o full care inclui

**Ainda apontando pra Wix:**
- o calendário de disponibilidade e o motor de reservas (`/availability-calendar`, `/booking-engine`)
- os 4 formulários de waiver

Quando decidirem o sistema de reservas definitivo, troque esses links em `book.html` e `waivers.html`.

**Formulário de contato:** salva em `data/review.json` e pode ser lido em `/api/contacts` (protegido pela senha). Configure `CONTACT_WEBHOOK_URL` pra receber cada mensagem em outro lugar.

**Antes de ir ao ar no domínio real:**
- troque `og:image` para o endereço completo (ex. `https://www.winningranch.com/img/og-image.jpg`)
- remova a senha se este mesmo serviço for servir o site público

## Limitações conhecidas

- Marcações feitas em elementos fixos na tela (o cabeçalho que acompanha a rolagem, a barra de botões do celular) ficam na posição da página, não acompanham o elemento quando rola.
- Uma seta ou caixa desenhada sobre áreas vazias fica presa ao bloco inteiro da seção. Se o layout mudar muito entre desktop e celular, ela pode cair em outro ponto. Pins em textos, botões e imagens são os mais precisos.
- Os comentários ficam num arquivo JSON. É ótimo pra uma equipe pequena revisando, mas não é pensado pra centenas de pessoas ao mesmo tempo.

Fontes Cinzel e Barlow: SIL Open Font License, ver `sites/ranch/fonts/`.
