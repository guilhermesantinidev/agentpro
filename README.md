# AgentPro 🤖

Assistente pessoal com IA para organizar sua agenda por texto ou por **voz**. Fale "agenda uma reunião amanhã às 10h" e o agente adiciona o evento automaticamente.

![AgentPro](https://img.shields.io/badge/versão-2.0-7c5cfc?style=flat-square) ![PWA](https://img.shields.io/badge/PWA-instalável-22d3ee?style=flat-square) ![Licença](https://img.shields.io/badge/licença-MIT-10b981?style=flat-square)

---

## ✨ Funcionalidades

- **Chat com IA** — converse com o agente para adicionar, remover e consultar tarefas
- **Entrada por voz** — clique no microfone e fale; a transcrição é enviada automaticamente à IA
- **Agenda inteligente** — filtros por Hoje / Amanhã / 7 dias / Tudo, agrupados por data
- **Personalidades da IA** — Coach Épico 🔥, Realista Ácido 😼, Comando Tático ⚔️ ou Zênite da Paz 🌸
- **Notificações** — alertas no horário exato de cada tarefa
- **Modo claro/escuro** — alterna com um clique, preferência salva
- **PWA instalável** — funciona como app nativo no celular e no desktop
- **100% local** — dados salvos no `localStorage`, sem servidor próprio

---

## 🚀 Como usar

### Opção 1 — Acessar online

Abra direto no browser (substitua pelo seu link do GitHub Pages):

```
https://SEU_USUARIO.github.io/agentpro/
```

### Opção 2 — Rodar localmente

```bash
git clone https://github.com/SEU_USUARIO/agentpro.git
cd agentpro
```

Abra o `index.html` em qualquer servidor local. Com o Python instalado:

```bash
python -m http.server 8080
# acesse http://localhost:8080
```

> ⚠️ Abrir o `index.html` diretamente como arquivo (`file://`) pode bloquear o Service Worker. Use sempre um servidor local ou o GitHub Pages.

---

## ⚙️ Configuração

1. Acesse [console.groq.com](https://console.groq.com) e crie uma conta gratuita
2. Gere uma **API Key** em *API Keys → Create API Key*
3. No AgentPro, cole a chave no campo **Chave API Groq** na barra lateral e clique em **Salvar**

Pronto. A chave fica salva localmente no seu browser.

---

## 🎤 Como usar o áudio

1. Clique no botão **🎤** ao lado do campo de texto
2. Conceda permissão de microfone quando o browser pedir (só na primeira vez)
3. Fale o comando — ex: *"agenda uma reunião com o cliente hoje às 15h"*
4. O texto aparece no campo em tempo real; ao parar de falar, a IA processa automaticamente

**Compatibilidade:** Chrome e Edge têm suporte completo. Firefox não suporta a Web Speech API.

---

## 🗂️ Estrutura do projeto

```
agentpro/
├── index.html      # estrutura e modais
├── app.js          # lógica principal, chat, voz, agenda
├── style.css       # estilos e tema claro/escuro
├── manifest.json   # configuração PWA
└── sw.js           # service worker (cache offline)
```

---

## 🛠️ Tecnologias

| Tecnologia | Uso |
|---|---|
| [Groq API](https://groq.com) | LLM (Llama 4 Scout) para o agente |
| Web Speech API | Reconhecimento de voz no browser |
| Lucide Icons | Ícones da interface |
| LocalStorage | Persistência de tarefas e preferências |
| Service Worker | Cache offline e instalação PWA |

---

## 🤖 Comandos de exemplo para o agente

```
"Agenda uma reunião amanhã às 14h"
"Cria uma tarefa de academia hoje às 7h"
"Remove a reunião de amanhã"
"O que tenho para essa semana?"
"Adiciona consulta médica na sexta às 10h30"
```

---

## 📋 Roadmap

- [ ] Histórico de chat persistido entre sessões
- [ ] Categorias e prioridades nas tarefas
- [ ] Tarefas recorrentes
- [ ] Exportar agenda como `.ics` (Google Calendar / Outlook)
- [ ] Busca de tarefas
- [ ] Proxy backend para proteger a chave API

---

## 📄 Licença

MIT — use, modifique e distribua à vontade.
