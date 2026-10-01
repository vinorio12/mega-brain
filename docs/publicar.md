# Publicar no GitHub Pages

Objetivo: o Mega Brain ganha um link próprio (`https://USUARIO.github.io/mega-brain/`),
abre em qualquer lugar e instala no celular.

Tudo é estático (HTML/CSS/JS), então o GitHub Pages serve direto, sem build.
O arquivo `.nojekyll` na raiz manda o GitHub servir os arquivos como estão.

## 1. Criar o repositório (Vini, no navegador)

1. github.com/new
2. Nome: `mega-brain` · **Public** · **não** marque README, .gitignore nem licença (o repositório precisa nascer vazio)
3. Create repository

## 2. Enviar o código (Claude, no terminal)

```
git remote add origin https://github.com/USUARIO/mega-brain.git
git push -u origin main
```

Na primeira vez, o Windows abre uma janela do **Git Credential Manager** pedindo login no GitHub.
É o Vini quem faz esse login, e depois ele fica salvo.

## 3. Ligar o Pages (Vini, no navegador)

No repositório: **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: **main** · pasta **/ (root)** → Save

Em 1 a 2 minutos o link aparece no topo da mesma página.

## 4. Avisar o Supabase do endereço novo

**Authentication → URL Configuration**
- Site URL: `https://USUARIO.github.io/mega-brain/`
- Redirect URLs: adicionar `https://USUARIO.github.io/mega-brain/**` e manter o `http://localhost:5173/**`

O login por senha funciona mesmo sem isso. O que precisa dele é o `/codigo` (link do e-mail).

## 5. Testar e instalar

- Abrir o link no PC → login → escrever uma nota → `/status` (memória `nuvem`, RT `on`)
- **Android (Chrome):** abrir o link → menu ⋮ → **Instalar app**
- **iPhone (Safari):** abrir o link → compartilhar → **Adicionar à Tela de Início**
- No celular, fazer login uma vez. A sessão fica salva.

## Atualizações depois de publicado

Cada `git push` publica a versão nova em 1 a 2 minutos. Antes de cada push:
1. aumentar o `CACHE` no `sw.js` (ex: `mb-shell-v13` → `v14`);
2. rodar os testes (`/tests/`).

O app instalado pega a versão nova na próxima vez que for aberto com internet.
