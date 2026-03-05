import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { initRealtime } from "./realtime/gateway.js";
import { apiRouter } from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: false,
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api", apiRouter);

// Serve static files in production
const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  const webDistPath = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      return next();
    }
    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
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
