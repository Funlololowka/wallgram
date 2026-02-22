import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { ensureSchema } from "./bootstrap/schema.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { initRealtime } from "./realtime/gateway.js";
import { apiRouter } from "./routes/index.js";

const app = express();

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: false,
  }),
);
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await ensureSchema();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: config.corsOrigin,
      credentials: false,
    },
  });

  initRealtime(io);

  server.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`Wallgram server running on http://${config.host}:${config.port}`);
    if (config.host === "0.0.0.0") {
      // eslint-disable-next-line no-console
      console.log(`Open from other devices: http://<YOUR-PC-IP>:${config.port}`);
    }
  });

  process.on("SIGINT", async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

start().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", error);
  await prisma.$disconnect();
  process.exit(1);
});
