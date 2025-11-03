import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User, IUser } from "../models/User";

export interface AuthRequest extends Request {
  user?: IUser;
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    // Get token from header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: "Not authorized, no token provided",
      });
      return;
    }

    try {
      // Verify token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "fallback-secret"
      ) as { id: string };

      // Get user from token
      const user = await User.findById(decoded.id).select("-password");

      if (!user || !user.isActive) {
        res.status(401).json({
          success: false,
          error: "User not found or inactive",
        });
        return;
      }

      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        error: "Not authorized, token failed",
      });
      return;
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error during authentication",
    });
  }
};

// Role-based authorization
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Not authorized",
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `User role '${req.user.role}' is not authorized to access this route`,
      });
      return;
    }

    next();
  };
};

// Check if user belongs to tenant
export const checkTenantAccess = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Not authorized",
    });
    return;
  }

  // Super admin can access all tenants
  if (req.user.role === "super-admin") {
    next();
    return;
  }

  // Check tenant access from params or body
  const requestedTenantId = req.params.tenantId || req.body.tenantId;

  if (requestedTenantId && req.user.tenantId) {
    if (requestedTenantId.toString() !== req.user.tenantId.toString()) {
      res.status(403).json({
        success: false,
        error: "Not authorized to access this tenant's data",
      });
      return;
    }
  }

  next();
};

