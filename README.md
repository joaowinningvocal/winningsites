# Winning Sites — rascunhos + ferramenta de revisão

Um app só (Node + Express) que serve os novos sites do **Winning Ranch** e do **Winning Realty** e uma tela de revisão onde dá pra marcar o site com comentários, setas e destaques.

| Endereço | O que é |
|---|---|
| `/review/` | Ferramenta de revisão (o link pra mandar pro chefe) |
| `/ranch/` | Rascunho do novo Winning Ranch |
| `/ranch/stalls.html` | Mapa interativo das baias (preços, fotos, disponibilidade, reserva) |
| `/ranch/sign.html` | Assinatura online dos waivers e agreements |
| `/ranch/app/` | App do rancho (POC): donos e equipe num login só, Home, Messages, ponto, checklist, posts |
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
   - `RESEND_API_KEY` e `REPORT_FROM` (relatórios de horas por email; veja "Time clock" abaixo). Sem isso, os relatórios vão para o `REPORT_WEBHOOK_URL` (ou `CONTACT_WEBHOOK_URL`), se existir
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
| `hero.jpg` | Topo da home (já tem a foto das baias com os cavalos) |
| `care.jpg` | "Why owners choose Winning Ranch" |
| `aisle.jpg` | Galeria: corredor das baias |
| `stall.jpg` | Galeria: dentro de uma baia |
| `rv.jpg` | Galeria: área de trailer e RV |

A mesma foto das baias (`barn-stalls.jpg`) aparece em todas as baias do celeiro no mapa até cada uma ganhar foto própria. Dá pra tirar ou trocar na aba **Stalls** do dashboard.

**Informações** marcadas em vermelho tracejado no site (procure `class="tbd"` no HTML):
- horário de visita
- o que o full care inclui

**Preços:** o preço por noite de cada baia ainda está vazio (o site mostra "Price on request"). Defina no **Pricing board** do dashboard. A faixa mensal ($750 a $1,000) já aparece no site e também é editável lá.

**Email de contato:** os links dizem "Email a team member", mas o endereço por trás ainda é `Jenna@WinningRanch.com`. Troque pelo endereço geral quando existir (busque `mailto:` nos HTML).

Nada mais aponta pra Wix: a reserva é pelo mapa e os waivers são assinados no próprio site.

**Formulário de contato:** salva em `data/review.json` e pode ser lido em `/api/contacts` (protegido pela senha). Configure `CONTACT_WEBHOOK_URL` pra receber cada mensagem em outro lugar.

**Antes de ir ao ar no domínio real:**
- troque `og:image` para o endereço completo (ex. `https://www.winningranch.com/img/og-image.jpg`)
- remova a senha se este mesmo serviço for servir o site público

## Winning Ranch: mapa, reservas, portal do dono e app da equipe

### Mapa das baias (`stalls.html`)
O visitante escolhe as datas e o mapa mostra quais baias estão livres. Passando o mouse numa baia aparece um card animado com a foto (ou um zoom do mapa enquanto não tiver foto), status e preço. Clicando, abre a ficha da baia com fotos, preço por noite e por mês, tamanho e o botão de adicionar à reserva. Dá pra juntar várias baias e mandar um pedido só. No celular o mapa rola de lado e o toque abre a ficha. Embaixo do mapa tem a lista de todas as baias.

O pedido fica **pendente** e já segura as baias. A equipe confirma ou recusa no app. **Ainda não tem pagamento online:** um membro da equipe confirma e cobra por telefone. O próximo passo natural é ligar o Stripe Checkout na confirmação.

**Trocar o mapa:** substitua `sites/ranch/img/ranch-map.jpg` (e `ranch-map-small.jpg`) e ajuste as posições em `lib/ranch-layout.js`: tamanho da imagem, retângulo de cada baia e as áreas sem reserva (arenas, round pens, estacionamento de trailer…), tudo em pixels da imagem. As posições não ficam no banco, então basta fazer o deploy. Os preços, fotos e status das baias continuam como estão.

As tarifas do site incluem full care. RV, trailer e dry hookups são confirmados com a equipe antes da reserva (o formulário tem uma caixa pra pessoa avisar).

### Portal do dono (`/ranch/portal/`)
O dono loga e vê os cavalos dele, com o feed de fotos e vídeos que a equipe posta, agrupado por dia. Funciona como app no celular: dá pra "Adicionar à tela de início" (tem manifest e ícones).

Não tem cadastro aberto. A equipe cria a pessoa no app e recebe um **link de acesso** pra mandar por SMS ou email (o sistema não envia email sozinho). A pessoa abre o link, cria a senha e já entra. O mesmo botão gera um link novo se ela esquecer a senha.

### App da equipe (`/ranch/admin/`)
Feito pra usar no celular, no meio do rancho:
- **Postar update:** escolhe o cavalo, tira foto ou vídeo e posta. O dono vê na hora.
- **Reservas:** pedidos que chegaram pelo mapa, com botões de confirmar, recusar, concluir e cancelar, além de uma nota interna.
- **Cavalos:** cadastro, dono e baia. Um cavalo numa baia deixa ela ocupada no mapa.
- **Pessoas:** donos e equipe, com os links de acesso.
- **Pricing (Pricing board):** o celeiro aparece no mapa com cada baia colorida pelo preço (clara = mais barata, vermelha = mais cara). Clique numa baia, use Shift para somar outras ou arraste uma caixa para pegar uma fileira inteira. Dá pra definir um preço exato, ajustar por $ ou % ou limpar, com prévia do antes e depois. Embaixo tem uma planilha com todas as baias para editar uma a uma (Enter salva e desce para a próxima). Toda mudança fica no histórico e a mais recente pode ser desfeita. Também ficam ali a faixa mensal mostrada no site e o preço da vaga de trailer/RV.
- **Stalls:** fotos, tamanho, status (em uso ou não) e descrição de cada baia.

### Waivers online (`/ranch/sign.html`)
Os quatro documentos do rancho (boarding agreement, adult lesson packet, adult liability waiver e employee packet) foram convertidos dos arquivos Word **sem mudar o texto**, inclusive os nomes das partes. A página mostra o documento pra ler (com o PDF original pra baixar) e um formulário com os mesmos campos em branco do papel. No boarding, isso inclui a ficha do cavalo: saúde, vacinas, alimentação, seguro, veterinário e a decisão sobre cirurgia, com as iniciais. No fim a pessoa marca que leu e concorda, aceita assinar eletronicamente, digita o nome e desenha a assinatura (funciona com o dedo no celular).

- **Menor de idade:** a pessoa marca a opção e quem assina é o pai, a mãe ou o responsável. O nome dele fica registrado.
- **Cópia assinada:** depois de assinar, a pessoa recebe um link privado pra abrir, imprimir ou salvar em PDF a cópia com o texto, as respostas e a assinatura.
- **Equipe:** a aba **Waivers** do dashboard lista tudo com busca e filtro por documento, abre a cópia assinada (com IP e aparelho) e tem o botão **Countersign** pra assinatura da ranch (Management). Também tem os links de assinatura pra mandar por SMS.
- **Versões:** cada assinatura guarda o texto exato que foi assinado. Se vocês editarem um documento depois (`sites/ranch/docs/<id>.html` e o PDF), as cópias antigas continuam mostrando a versão que a pessoa assinou.
- **Campos:** os campos de cada documento estão em `lib/docs.js`.
- **W-9:** fica só pra baixar. O site não coleta número de Social Security.

Vale o advogado de vocês revisar o fluxo antes de aposentar o papel (consentimento eletrônico, menores de idade e retenção dos registros).

### Time clock (ponto) e checklist do turno
Cada pessoa da equipe tem uma **posição** (aba People):
- **Ranch hand:** vê só "My shift" e "Post update".
- **Ranch manager:** vê tudo e também bate ponto.
- **Office:** vê tudo e não bate ponto (Randy e Jenna).

Quem já tinha login fica como Office.

**My shift (no celular):**
- **Clock in** só funciona dentro do raio da ranch. O celular pede permissão de localização, e quem está longe recebe a distância e não consegue bater o ponto.
- **Start break / End break** tira os intervalos das horas.
- O checklist da Gabi é marcado item por item.
- **Notas pra gerência:** marcando "Urgent", vai email na hora.
- **Clock out:** se faltar item do checklist, pede uma nota do que ficou pendente. Bater a saída não exige estar na ranch, mas fica marcado se for longe.

**Hours (gerente e office):**
- Quem está no relógio agora.
- O dia com cada turno: entrada, saída, intervalos, horas, checklist e alertas, como "No clock-out", "Clocked out 12.5 miles from the ranch" ou "Checklist 20/29".
- **Fix** pra corrigir horários, com motivo obrigatório que vai pro relatório.
- **Add a missed shift**, que aceita virada de noite.
- A **semana de pagamento** com o total por pessoa em horas decimais e o **CSV para a folha**.

**Configurar uma vez (Hours, "Time clock settings"):**
1. Em pé no celeiro, toque **Use where I am now** pra salvar a localização da ranch. O raio padrão é 150 m (uns 500 ft).
2. Coloque o email da Jenna em **Send reports to** (dá pra pôr vários, separados por vírgula).
3. Ajuste o horário do relatório diário (padrão 7:00) e o dia em que começa a semana de pagamento (padrão segunda).
4. O checklist também é editado ali: `#` começa uma seção e cada linha é uma tarefa.

**Relatórios:** todo dia, no horário escolhido, vai o relatório do dia anterior (pra conferência). No primeiro dia da semana de pagamento vai o semanal, com o CSV anexo (pra folha). Os dois também podem ser enviados na hora pelo dashboard.

**Ligar o email:**
1. Crie uma conta grátis em resend.com.
2. Verifique o domínio winningranch.com: ele mostra uns registros DNS pra adicionar.
3. No Railway, coloque `RESEND_API_KEY` e `REPORT_FROM="Winning Ranch <reports@winningranch.com>"`.

Enquanto o domínio não estiver verificado, dá pra testar com o remetente padrão do Resend, que só entrega pro email da conta.

**Limites:**
- A localização vem do celular. Inibe bastante, mas um aplicativo de GPS falso consegue enganar.
- O sistema não calcula hora extra nem salário. Só marca dias acima de 8 h e semanas acima de 40 h pra quem fecha a folha decidir (Nevada tem regras próprias de overtime).

### Apagar waivers
Na aba Waivers, **Delete** tira um documento da lista (por exemplo, testes ou um formulário preenchido errado) e desativa o link da cópia do signatário. Dá pra informar um motivo. Nada é apagado de vez: em **Deleted** o documento pode ser restaurado.

### App do rancho (POC) em `/ranch/app/`
O protótipo segue o mesmo modelo do Winning App: um login só pra donos e equipe, uma Home que muda conforme a função, Messages, o sino de notificações e, pra equipe, o botão de câmera no meio da barra de baixo.

**Dono:**
- Home com os cavalos dele (foto, baia, último update, contador de novos).
- O feed de fotos e vídeos de cada cavalo.
- "Message the ranch": um chat privado com toda a equipe.
- Atalhos pra reservar baia, assinar waivers, ver o mapa e ligar.

**Ranch hand e ranch manager:**
- Cartão de ponto na Home (clock in com localização, intervalo, clock out).
- O checklist do turno.
- O botão de câmera pra postar foto ou vídeo pro dono.
- Messages com o chat da equipe e um chat por dono.

**Manager e office:**
- Contadores de reservas pendentes, waivers pra contra-assinar e quem está no relógio.
- Atalhos pro dashboard completo.

A Home se instala como app no celular ("Adicionar à tela de início") e tem modo escuro no menu do perfil. O mesmo endereço pode virar app nativo com Capacitor, como o Winning App.

**Limites do POC:**
- As mensagens atualizam a cada poucos segundos, sem push.
- Notificação push no celular (como o Firebase do Winning App) fica pra versão nativa.

### Onde ficam os dados
Tudo fica em `DATA_DIR`: `ranch.json` (baias, reservas, pessoas, cavalos, updates, histórico de preços, waivers assinados, versões dos documentos, turnos, relatórios enviados, chats e mensagens) e `uploads/` (fotos das baias são públicas; fotos e vídeos dos cavalos e as assinaturas desenhadas só abrem para quem tem acesso). Por isso o Volume no Railway é obrigatório.

### Limitações desta versão
- Sem pagamento online e sem envio automático de email/SMS.
- Vídeos ficam no Volume do Railway. Pra muitos vídeos, o certo é migrar para S3 ou Cloudflare R2.
- Vídeo `.mov` de iPhone (HEVC) toca no Safari, mas pode não tocar no Chrome do computador. Fotos HEIC idem. Converter na hora do upload fica pra uma próxima versão.
- Atualizações de dados de versões anteriores rodam sozinhas uma vez na inicialização (tamanho 12' x 24', faixa mensal, foto do celeiro). Elas não sobrescrevem o que a equipe já mudou.
- Os dados ficam em um arquivo JSON. Quando virar app com muitos usuários, migrar para Postgres (o código de rotas já está separado em `routes/ranch.js`).

## Limitações conhecidas (ferramenta de revisão)

- Marcações feitas em elementos fixos na tela (o cabeçalho que acompanha a rolagem, a barra de botões do celular) ficam na posição da página, não acompanham o elemento quando rola.
- Uma seta ou caixa desenhada sobre áreas vazias fica presa ao bloco inteiro da seção. Se o layout mudar muito entre desktop e celular, ela pode cair em outro ponto. Pins em textos, botões e imagens são os mais precisos.
- Os comentários ficam num arquivo JSON. É ótimo pra uma equipe pequena revisando, mas não é pensado pra centenas de pessoas ao mesmo tempo.

Fontes Cinzel e Barlow: SIL Open Font License, ver `sites/ranch/fonts/`.
