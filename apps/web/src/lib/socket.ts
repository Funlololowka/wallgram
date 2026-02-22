import { io, type Socket } from "socket.io-client";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? window.location.origin;

export function createSocket(token: string): Socket {
  return io(API_ORIGIN, {
    path: "/socket.io",
    transports: ["websocket"],
    auth: { token },
  });
}
