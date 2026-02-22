import type { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";

let ioRef: Server | null = null;

interface SocketAuth {
  token?: string;
}

async function attachRooms(socket: Socket, userId: string) {
  socket.join(`user:${userId}`);
  const memberships = await prisma.chatMember.findMany({
    where: { userId },
    select: { chatId: true },
  });

  for (const membership of memberships) {
    socket.join(`chat:${membership.chatId}`);
  }
}

export function initRealtime(io: Server) {
  ioRef = io;

  io.use((socket, next) => {
    const auth = socket.handshake.auth as SocketAuth;
    if (!auth.token) {
      next(new Error("Unauthorized"));
      return;
    }

    try {
      const payload = verifyToken(auth.token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;
    await attachRooms(socket, userId);

    socket.on("chat:join", async (chatId: string) => {
      const membership = await prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId, userId } },
      });
      if (membership) {
        socket.join(`chat:${chatId}`);
      }
    });
  });
}

export function emitToChat(chatId: string, event: string, payload: unknown) {
  ioRef?.to(`chat:${chatId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  ioRef?.to(`user:${userId}`).emit(event, payload);
}
