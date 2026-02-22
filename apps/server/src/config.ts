import dotenv from "dotenv";

dotenv.config();

function parseCorsOrigin(rawValue: string | undefined): true | string[] {
  const source = (rawValue ?? "*").trim();
  if (!source || source === "*") {
    return true;
  }

  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
};
