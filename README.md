# Winning Ranch

Um serviço só (Node + Express, no Railway) com o **web-app** do rancho, o **site**, o **dashboard** e a **API**.

| Endereço | O que é |
|---|---|
| `/` | Web-app do Winning Ranch: login único para donos e equipe |
| `/home.html` | Site: home, comodidades, FAQ |
| `/stalls.html` | Mapa das baias com disponibilidade, preços, fotos e pedido de reserva |
| `/waivers.html`, `/sign.html?doc=…` | Waivers e agreements assinados online |
| `/book.html`, `/contact.html` | Como reservar, formulário de contato |
| `/admin/` | Dashboard completo (office e ranch manager) |
| `/api/ranch/*` | API usada por tudo acima |

Endereços antigos (`/ranch/...`, `/portal/`, `/review/`) redirecionam sozinhos.

## Rodar no computador

```bash
npm install
npm start          # http://localhost:3000
```

## Railway

1. **Volume** montado em `/data` e a variável `DATA_DIR=/data` (sem isso, tudo some a cada deploy).
2. **Primeiro login da equipe:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `ADMIN_NAME`. Depois de criado, dá pra tirar a senha das variáveis.
3. **Emails dos relatórios de horas:** `RESEND_API_KEY` e `REPORT_FROM` (ex. `Winning Ranch <reports@winningranch.com>`). Veja "Ponto e relatórios".
4. **Opcionais:**
   - `BOOKING_WEBHOOK_URL`, `CONTACT_WEBHOOK_URL` e `REPORT_WEBHOOK_URL`: cópias de reservas, contatos, waivers e relatórios para o integrator.io ou o Zapier.
   - `SEED_DEMO=1`: cria o dono de teste `demo@winningranch.com` / `demo-ranch`. Tire antes de ir ao ar.
5. A variável `REVIEW_PASSWORD` não é mais usada e pode ser apagada.

## O app (`/`)

O app segue o modelo do Winning App: top bar com sino e chip da função, Home conforme a função, Messages na barra de baixo e, para a equipe, o botão de câmera no meio.

**Dono:**
- Os cavalos dele, com foto, baia, último update e "N new".
- O feed de fotos e vídeos de cada cavalo.
- "Message the ranch": um chat privado com a equipe.
- Atalhos para reservar, assinar waivers, ver o mapa, ligar e abrir a rota.

**Ranch hand e ranch manager:**
- Ponto na Home: clock in conferindo a localização, intervalo e clock out.
- O checklist do turno.
- O botão de câmera para postar no feed do dono.
- O chat da equipe e um chat por dono.

**Manager e office:**
- Reservas esperando, waivers para contra-assinar, quem está no relógio.
- Atalhos para o dashboard.

**Visitantes** veem na tela de login os atalhos para reservar, assinar waivers e conhecer o rancho.

Não tem cadastro aberto. A equipe cria a pessoa em **People** (no dashboard) e manda o link de acesso por SMS ou email. A pessoa abre, cria a senha e entra no app.

O app instala no celular pelo "Adicionar à tela de início" e tem modo escuro. A versão nas lojas sai embrulhando o mesmo endereço com Capacitor, como o Winning App.

## Dashboard (`/admin/`)

| Aba | Função |
|---|---|
| My shift | Ponto e checklist (hand e manager) |
| Post update | Postar fotos e vídeos de um cavalo |
| Bookings | Pedidos de reserva: confirmar, recusar, concluir, cancelar |
| Hours | Turnos do dia, correções, semana de pagamento, CSV, configurações do ponto |
| Horses | Cavalos, dono e baia |
| People | Donos e equipe, posição (ranch hand, ranch manager, office) e links de acesso |
| Pricing | Pricing board: mapa colorido por preço, seleção múltipla, ajuste em $ ou %, planilha, histórico com desfazer, faixa mensal do site |
| Stalls | Fotos, tamanho, status e descrição de cada baia |
| Waivers | Documentos assinados, cópia para imprimir, countersign, apagar e restaurar, links para assinar |

Ranch hands só veem **My shift** e **Post update**.

## Ponto e relatórios

Configurar uma vez em **Hours → Time clock settings**:
1. Em pé no celeiro, toque **Use where I am now** (raio padrão de 150 m).
2. Coloque o email da Jenna em **Send reports to**.
3. Ajuste o horário do relatório diário (padrão 7:00) e o dia em que começa a semana de pagamento (padrão segunda).
4. O checklist é editado ali mesmo: `#` abre uma seção e cada linha é uma tarefa.

Todo dia vai por email o relatório do dia anterior. No primeiro dia da semana de pagamento vai o semanal, com o CSV para a folha.

**Ligar o email:**
1. Crie uma conta em resend.com.
2. Verifique o domínio winningranch.com (registros DNS).
3. Coloque `RESEND_API_KEY` e `REPORT_FROM` no Railway.

O sistema não calcula hora extra nem salário: só marca dias acima de 8 h e semanas acima de 40 h.

## Trocar o mapa

Substitua `public/img/ranch-map.jpg` (e `ranch-map-small.jpg`) e ajuste `lib/ranch-layout.js`: o tamanho da imagem, o retângulo de cada baia e as áreas sem reserva, tudo em pixels da imagem. Preços, fotos e status das baias continuam como estão.

## Documentos para assinar

O texto fica em `public/docs/<id>.html`, convertido dos arquivos Word sem mudar a redação, com o PDF original ao lado. Os campos de cada documento ficam em `lib/docs.js`. Cada assinatura guarda a versão exata que foi assinada. O W-9 é só para baixar: o site não coleta número de Social Security. Vale o advogado revisar o fluxo antes de aposentar o papel.

## Dados

Tudo fica em `DATA_DIR`:
- `ranch.json`: baias, reservas, pessoas, cavalos, updates, preços, waivers, turnos, chats e contatos.
- `uploads/`: fotos e vídeos. As fotos das baias são públicas; o resto só abre para quem tem acesso.

Atualizações de dados de versões anteriores rodam sozinhas uma vez na inicialização, sem sobrescrever o que a equipe mudou.

## O que ainda falta preencher

- **Preço por noite de cada baia:** no Pricing board.
- **No site, marcados em vermelho tracejado:**
  - jumps e barrels;
  - tipo de feno incluso e quantidade;
  - horário de visita;
  - o que o full care inclui.
- **Fotos reais:** troque os arquivos em `public/img/photos/` (`care.jpg`, `aisle.jpg`, `stall.jpg`, `rv.jpg` e, se quiser, `proseries.jpg`).
- **Email de contato do site:** os links ainda usam `Jenna@WinningRanch.com`.

## Limites

- As mensagens do app atualizam a cada poucos segundos (sem push no celular ainda).
- A localização do ponto vem do celular: inibe bastante, mas GPS falso consegue enganar.
- Os dados ficam num arquivo JSON, o que serve para o tamanho do rancho. Para crescer muito, migrar para Postgres.

## Estrutura

```
server.js            serve o app, o site e a API
routes/ranch.js      baias, reservas, login, cavalos, updates, preços, waivers, contato
routes/shifts.js     ponto, checklist, horas, relatórios
routes/chats.js      chats do app e dados da Home
lib/                 store JSON, login, layout do mapa, documentos, cálculo de horas, email
public/index.html    o app (public/app/ tem o CSS, o JS e o manifest)
public/admin/        o dashboard
public/*.html        o site
```
