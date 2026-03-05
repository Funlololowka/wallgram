# Wallgram

Wallgram is a full-stack messenger platform inspired by Telegram architecture, built as a monorepo:

- `apps/server`: REST API + realtime gateway (Socket.IO) + Prisma (PostgreSQL)
- `apps/web`: Vite + React client

## Deployment (Railway)

This project is configured for deployment on [Railway](https://railway.app/).

1. Create a new PostgreSQL database on Railway.
2. Add a new service from your repository.
3. Set the `DATABASE_URL` environment variable from the Postgres service.
   - **IMPORTANT**: Ensure it's NOT `localhost`. Use the URL provided by your Railway Postgres service.
4. Set other environment variables: `JWT_SECRET`, `NODE_ENV=production`.
5. Railway will automatically build and start the project.

## Implemented now

- User auth (register/login/me/profile)
- Search users
- Direct chats, groups, channels
- Roles (`OWNER` / `ADMIN` / `MEMBER`)
- Messaging with:
  - edits
  - delete (soft delete)
  - forward
  - reactions
  - replies (model-level support, API accepts `replyToId`)
  - media metadata fields
- Chat pin, read markers
- Realtime updates for chats/messages/reactions over WebSockets

## Local run

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp apps/server/.env.example apps/server/.env
```

3. Generate Prisma client:

```bash
npm run prisma:generate --workspace @wallgram/server
```

Database tables are auto-created on server startup.

4. Start both apps:

```bash
npm run dev
```

Server: `http://localhost:4000`  
Web: `http://localhost:5173`

## Open from another device (LAN)

`localhost` works only on the same device. For phone/tablet in the same Wi-Fi:

1. Find your PC LAN IP (for example `192.168.1.25`).
2. Start the project with `npm run dev`.
3. Open on the second device: `http://<PC-IP>:5173` (example: `http://192.168.1.25:5173`).
4. If it does not open, allow inbound connections for Node.js in Windows Firewall (at least port `5173`).

Note: in dev mode the web app proxies `/api` and `/socket.io` through Vite, so the second device talks to one port (`5173`).

## API overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `GET /api/users/search?q=...`
- `GET /api/chats`
- `POST /api/chats/direct`
- `POST /api/chats`
- `POST /api/chats/:chatId/members`
- `PATCH /api/chats/:chatId/members/:userId`
- `GET /api/chats/:chatId/messages`
- `POST /api/chats/:chatId/messages`
- `POST /api/chats/:chatId/read`
- `POST /api/chats/:chatId/pin`
- `PATCH /api/messages/:messageId`
- `DELETE /api/messages/:messageId`
- `POST /api/messages/:messageId/reactions`
- `DELETE /api/messages/:messageId/reactions/:emoji`
- `POST /api/messages/:messageId/forward`
