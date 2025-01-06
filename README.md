# Eliza

## Edit the character files

Open `agent/src/character.ts` to modify the default character. Uncomment and edit.

### Custom characters

To load custom characters instead:
- Use `pnpm start --characters="path/to/your/character.json"`
- Multiple character files can be loaded simultaneously

### Add clients

```diff
- clients: [],
+ clients: ["twitter", "discord"],
```

## Duplicate the .env.example template

```bash
cp .env.example .env
```

\* Fill out the .env file with your own values.

### Add login credentials and keys to .env

```diff
-DISCORD_APPLICATION_ID=
-DISCORD_API_TOKEN= # Bot token
+DISCORD_APPLICATION_ID="000000772361146438"
+DISCORD_API_TOKEN="OTk1MTU1NzcyMzYxMT000000.000000.00000000000000000000000000000000"
...
-OPENROUTER_API_KEY=
+OPENROUTER_API_KEY="sk-xx-xx-xxx"
...
-TWITTER_USERNAME= # Account username
-TWITTER_PASSWORD= # Account password
-TWITTER_EMAIL= # Account email
+TWITTER_USERNAME="username"
+TWITTER_PASSWORD="password"
+TWITTER_EMAIL="your@email.com"
```

## Install dependencies and start your agent

```bash
pnpm i && pnpm start
```


```
eliza-starter
├─ characters
│  ├─ eliza.character.json
│  ├─ tate.character.json
│  └─ trump.character.json
├─ client
│  ├─ .gitignore
│  ├─ .turbo
│  │  └─ turbo-build.log
│  ├─ components.json
│  ├─ dist
│  │  ├─ assets
│  │  │  ├─ index-C5G8T_UT.css
│  │  │  └─ index-DgPB3tLP.js
│  │  ├─ index.html
│  │  └─ vite.svg
│  ├─ eslint.config.js
│  ├─ index.html
│  ├─ package.json
│  ├─ postcss.config.js
│  ├─ public
│  │  └─ vite.svg
│  ├─ src
│  │  ├─ App.css
│  │  ├─ assets
│  │  │  └─ react.svg
│  │  ├─ components
│  │  │  └─ ui
│  │  ├─ hooks
│  │  ├─ index.css
│  │  └─ lib
│  ├─ tailwind.config.js
│  ├─ tsconfig.app.json
│  ├─ tsconfig.json
│  └─ tsconfig.node.json
├─ content_cache
├─ data
├─ package.json
├─ packages
│  └─ plugin-evm
│     ├─ .turbo
│     │  └─ turbo-build.log
│     ├─ README.md
│     ├─ dist
│     │  ├─ index.js
│     │  └─ index.js.map
│     ├─ eslint.config.mjs
│     ├─ package.json
│     ├─ src
│     │  ├─ actions
│     │  ├─ providers
│     │  ├─ templates
│     │  ├─ tests
│     │  └─ types
│     └─ tsconfig.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ scripts
│  └─ clean.sh
├─ src
├─ tsconfig.json
└─ turbo.json

```