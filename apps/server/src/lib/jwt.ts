import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthPayload {
  sub: string;
}

export function signToken(userId: string): string {
  const expiresIn = config.jwtExpiresIn as jwt.SignOptions["expiresIn"];
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn,
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, config.jwtSecret) as AuthPayload;
}
