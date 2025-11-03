import jwt from "jsonwebtoken";

export const generateToken = (id: string): string => {
  return jwt.sign({ id }, process.env.JWT_SECRET || "fallback-secret", {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

