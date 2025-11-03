import express, { Response } from "express";
import { protect, AuthRequest, authorize } from "../middleware/auth";
import { emailService } from "../utils/emailService";
import { body, validationResult } from "express-validator";

const router = express.Router();

// @route   POST /api/email/send
// @desc    Send generic email
// @access  Private (Admin only)
router.post(
  "/send",
  protect,
  authorize("super-admin", "tenant-admin"),
  [
    body("to").isEmail().withMessage("Valid email is required"),
    body("subject").notEmpty().withMessage("Subject is required"),
    body("message").notEmpty().withMessage("Message is required"),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { to, subject, message } = req.body;

      const result = await emailService.sendGenericEmail(to, subject, message);

      if (result) {
        res.json({
          success: true,
          message: "Email sent successfully",
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Failed to send email",
        });
      }
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Server error",
      });
    }
  }
);

// @route   POST /api/email/test
// @desc    Test email configuration
// @access  Private (Admin only)
router.post("/test", protect, authorize("super-admin"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const testEmail = user.email;

    const result = await emailService.sendGenericEmail(
      testEmail,
      "Test Email - Helpdesk System",
      `Hello ${user.name},\n\nThis is a test email from the Helpdesk System. If you received this email, your SMTP configuration is working correctly.\n\nBest regards,\nHelpdesk System`
    );

    if (result) {
      res.json({
        success: true,
        message: `Test email sent to ${testEmail}`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Failed to send test email. Please check SMTP configuration.",
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

