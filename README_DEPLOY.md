# 🚀 Deploy AgentPro no Firebase

## Pré-requisitos

- Node.js v18+
- Conta no [Firebase Console](https://console.firebase.google.com)
- Conta na [Groq](https://console.groq.com) (gratuita) para obter a API Key

---

## Passo 1 — Instalar Firebase CLI

```bash
npm install -g firebase-tools
```

---

## Passo 2 — Login

```bash
firebase login
```

---

## Passo 3 — Instalar dependências da Cloud Function

```bash
cd functions
npm install
cd ..
```

---

## Passo 4 — Configurar a chave Groq como variável de ambiente

```bash
firebase functions:secrets:set GROQ_API_KEY
```

Cole sua chave da Groq quando solicitado. Ela ficará armazenada com segurança no Secret Manager do Google Cloud — **nunca exposta no código**.

---

## Passo 5 — Deploy completo (hosting + functions)

```bash
firebase deploy
```

Ao final você verá a URL pública:

```
✔  Deploy complete!
Hosting URL: https://agentpro-b365c.web.app
```

---

## Atualizar após mudanças

```bash
firebase deploy
```

Para deploy só do hosting (sem mudar a função):

```bash
firebase deploy --only hosting
```

---

## Estrutura do projeto

```
agentpro/
├── index.html           # App principal
├── login.html           # Tela de login/registro
├── app.js               # Lógica do agente + agenda + voz
├── auth.js              # Firebase Auth + Firestore
├── firebase-config.js   # Config do Firebase (projeto)
├── style.css            # Estilos e tema claro/escuro
├── manifest.json        # Config PWA
├── sw.js                # Service Worker
├── firebase.json        # Config hosting + functions
├── .firebaserc          # ID do projeto
└── functions/
    ├── index.js         # Cloud Function groqProxy (proxy seguro)
    └── package.json     # Dependências da função
```

---

## Solução de problemas

| Problema | Solução |
|---|---|
| `firebase: command not found` | `npm install -g firebase-tools` |
| Chat retorna 401 | Você não está logado no app — faça login |
| Chat retorna 500 | Execute `firebase functions:secrets:set GROQ_API_KEY` |
| PWA não instala | Acesse por HTTPS (o Firebase já fornece) |
| Mudanças não aparecem | Force refresh com Ctrl+Shift+R |
