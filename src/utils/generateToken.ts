import jwt from "jsonwebtoken";

export const generateToken = (id: string): string => {
  const secret = process.env.JWT_SECRET || "fallback-secret";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ id }, secret, {
    expiresIn: expiresIn,
  } as jwt.SignOptions);
};

