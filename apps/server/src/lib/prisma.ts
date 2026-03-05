import { PrismaClient } from "@prisma/client";

const dbUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && dbUrl?.includes("localhost")) {
  console.warn("WARNING: DATABASE_URL is pointing to 'localhost' in production environment.");
}

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});
