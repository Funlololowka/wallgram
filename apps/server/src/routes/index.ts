import { Router } from "express";
import { authRouter } from "./auth.js";
import { usersRouter } from "./users.js";
import { chatsRouter } from "./chats.js";
import { messagesRouter } from "./messages.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "wallgram-server" });
});

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/chats", chatsRouter);
router.use("/messages", messagesRouter);

export const apiRouter = router;
