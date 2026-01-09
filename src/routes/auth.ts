import express, { Request, Response } from "express";
import { validationResult } from "express-validator";
import crypto from "crypto";
import { User } from "../models/User";
import { Tenant } from "../models/Tenant";
import { generateToken } from "../utils/generateToken";
import { validateRegister, validateLogin } from "../middleware/validator";
import { protect, AuthRequest } from "../middleware/auth";
import { emailService } from "../utils/emailService";

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post("/register", validateRegister, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { name, email, password, role, companyName, tenantId } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User already exists with this email",
      });
    }

    let finalTenantId = tenantId;

    // If tenant-admin role, create new tenant
    if (role === "tenant-admin" && !tenantId) {
      const webhookToken = `wh_tenant_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      const newTenant = await Tenant.create({
        name: companyName || name,
        email,
        channels: {
          email,
        },
        webhookToken,
      });

      finalTenantId = newTenant._id;
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role,
      tenantId: finalTenantId,
      companyName,
      avatar: name.substring(0, 2).toUpperCase(),
    });

    // Generate token
    const token = generateToken(String(user._id));

    // Send welcome email (non-blocking)
    if (role === "tenant-admin" && finalTenantId) {
      const tenant = await Tenant.findById(finalTenantId);
      emailService
        .sendWelcomeEmail(user.email, user.name, tenant?.name || companyName || name)
        .catch((err) => console.error("Failed to send welcome email:", err));
    }

    res.status(201).json({
      success: true,
      data: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId?.toString(),
        avatar: user.avatar,
        companyName: user.companyName,
      },
      token,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post("/login", validateLogin, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { email, password } = req.body;

    // Hardcoded super-admin check
    const SUPER_ADMIN_EMAIL = "sdsiteadmin@sentientdigital.in";
    const SUPER_ADMIN_PASSWORD = "Sentient1234@";

    if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() && password === SUPER_ADMIN_PASSWORD) {
      // Find or create super-admin user
      let user = await User.findOne({ email: SUPER_ADMIN_EMAIL });

      if (!user) {
        // Create super-admin user if doesn't exist
        user = await User.create({
          name: "Super Admin",
          email: SUPER_ADMIN_EMAIL,
          password: SUPER_ADMIN_PASSWORD,
          role: "super-admin",
          isActive: true,
          avatar: "SA",
        });
      } else {
        // Ensure user is super-admin and active
        if (user.role !== "super-admin") {
          user.role = "super-admin";
        }
        user.isActive = true;
        await user.save();
      }

      // Generate token
      const token = generateToken(String(user._id));

      return res.json({
        success: true,
        data: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: "super-admin", // Always return super-admin
          tenantId: user.tenantId?.toString(),
          avatar: user.avatar,
          companyName: user.companyName,
        },
        token,
      });
    }

    // Check for user
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is inactive",
      });
    }

    // Generate token
    const token = generateToken(String(user._id));

    res.json({
      success: true,
      data: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId?.toString(),
        avatar: user.avatar,
        companyName: user.companyName,
      },
      token,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Forgot password - send reset email
// @access  Public
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      return res.json({
        success: true,
        message: "If an account with that email exists, a password reset link has been sent.",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Set token and expiration (1 hour)
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpire = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${resetToken}`;

    // Send email
    try {
      await emailService.sendPasswordResetEmail(user.email, user.name, resetToken, resetUrl);
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
      // Clear token if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
      return res.status(500).json({
        success: false,
        error: "Failed to send reset email. Please try again later.",
      });
    }

    res.json({
      success: true,
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: "Token and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
    }

    // Hash the token to compare with stored hash
    const resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: resetTokenHash,
      resetPasswordExpire: { $gt: Date.now() },
    }).select("+password");

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token",
      });
    }

    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({
      success: true,
      message: "Password has been reset successfully. You can now login with your new password.",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get("/me", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select("-password");

    res.json({
      success: true,
      data: {
        id: String(user!._id),
        name: user!.name,
        email: user!.email,
        role: user!.role,
        tenantId: user!.tenantId?.toString(),
        avatar: user!.avatar,
        companyName: user!.companyName,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

