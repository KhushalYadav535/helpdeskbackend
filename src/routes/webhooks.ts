import express, { Response } from "express";
import { Ticket } from "../models/Ticket";
import { Customer } from "../models/Customer";
import { Activity } from "../models/Activity";
import { User } from "../models/User";
import { detectTenantFromChannel, detectTenantFromToken } from "../utils/detectTenant";
import { autoAssignAgent } from "../utils/autoAssignAgent";
import { emailService } from "../utils/emailService";
import mongoose from "mongoose";

const router = express.Router();

// Helper function to detect priority from message
const detectPriority = (message: string): "Critical" | "High" | "Medium" | "Low" => {
  const msg = message.toLowerCase();
  if (msg.includes("urgent") || msg.includes("critical") || msg.includes("emergency")) {
    return "Critical";
  }
  if (msg.includes("important") || msg.includes("asap") || msg.includes("immediate")) {
    return "High";
  }
  if (msg.includes("low") || msg.includes("whenever")) {
    return "Low";
  }
  return "Medium";
};

// @route   POST /api/webhooks/ticket
// @desc    Universal webhook endpoint
// @access  Public
router.post("/ticket", async (req: express.Request, res: Response) => {
  try {
    const {
      channel,
      tenantId,
      source,
      phoneNumber,
      telegramId,
      email,
      message,
      subject,
      customerName,
      customerEmail,
      customerPhone,
      priority,
      category,
      metadata = {},
    } = req.body;

    const finalChannel = channel || source || "web";

    // Detect tenant if not provided
    let finalTenantId = tenantId;
    if (!finalTenantId) {
      if (phoneNumber) {
        finalTenantId =
          (await detectTenantFromChannel("phone", phoneNumber)) ||
          (await detectTenantFromChannel("whatsapp", phoneNumber));
      } else if (telegramId) {
        finalTenantId = await detectTenantFromChannel("telegram", telegramId);
      } else if (email || customerEmail) {
        finalTenantId = await detectTenantFromChannel("email", email || customerEmail);
      }
    }

    if (!finalTenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant not found. Please provide tenantId or use a registered channel.",
      });
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(finalTenantId);

    // Create or find customer
    let customerId;
    if (customerEmail || customerPhone || customerName) {
      const existingCustomer = await Customer.findOne({
        tenantId: new mongoose.Types.ObjectId(finalTenantId),
        $or: [
          { email: customerEmail },
          { phone: customerPhone },
        ],
      });

      if (existingCustomer) {
        customerId = existingCustomer._id;
      } else {
        const newCustomer = await Customer.create({
          tenantId: new mongoose.Types.ObjectId(finalTenantId),
          name: customerName || "Unknown",
          email: customerEmail,
          phone: customerPhone,
        });
        customerId = newCustomer._id;
      }
    }

    // Create ticket
    const ticket = await Ticket.create({
      title: subject || `Ticket from ${finalChannel}`,
      description: message || subject || "No description provided",
      priority: priority || detectPriority(message || ""),
      category: category || "general",
      tenantId: new mongoose.Types.ObjectId(finalTenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customerId,
      customer: customerName || customerEmail || customerPhone || "Anonymous",
      customerEmail,
      customerPhone,
      source: finalChannel,
      channel: finalChannel,
      metadata,
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: `Ticket created from ${finalChannel}`,
      user: customerName || "System",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/whatsapp
// @desc    WhatsApp webhook
// @access  Public
router.post("/whatsapp", async (req: express.Request, res: Response) => {
  try {
    const { from, message, contactName, whatsappNumber } = req.body;

    if (!whatsappNumber || !message) {
      return res.status(400).json({
        success: false,
        error: "whatsappNumber and message are required",
      });
    }

    // Detect tenant from WhatsApp number
    const tenantId = await detectTenantFromChannel("whatsapp", whatsappNumber);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant not found for this WhatsApp number",
      });
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId);

    // Create or find customer
    let customerId;
    const existingCustomer = await Customer.findOne({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      phone: from,
    });

    if (existingCustomer) {
      customerId = existingCustomer._id;
    } else {
      const newCustomer = await Customer.create({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        name: contactName || from,
        phone: from,
      });
      customerId = newCustomer._id;
    }

    // Create ticket
    const ticket = await Ticket.create({
      title: `WhatsApp: ${contactName || from}`,
      description: message,
      priority: detectPriority(message),
      category: "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customerId,
      customer: contactName || from,
      customerPhone: from,
      source: "whatsapp",
      channel: "whatsapp",
      metadata: {
        whatsappNumber,
        from,
      },
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: "Ticket created from WhatsApp",
      user: contactName || "WhatsApp User",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("WhatsApp webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/telegram
// @desc    Telegram webhook
// @access  Public
router.post("/telegram", async (req: express.Request, res: Response) => {
  try {
    const { message, bot_username } = req.body;

    if (!bot_username) {
      return res.status(400).json({
        success: false,
        error: "bot_username is required",
      });
    }

    const msg = message?.text || message?.message?.text || "";
    const from = message?.from || message?.chat || {};

    // Detect tenant from bot username
    const tenantId = await detectTenantFromChannel("telegram", bot_username);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant not found for this Telegram bot",
      });
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId);

    // Create ticket
    const ticket = await Ticket.create({
      title: `Telegram: ${from.first_name || from.username || "User"}`,
      description: msg,
      priority: detectPriority(msg),
      category: "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customer: `${from.first_name || ""} ${from.last_name || ""}`.trim() || from.username || "Telegram User",
      source: "telegram",
      channel: "telegram",
      metadata: {
        bot_username,
        telegram_chat_id: from.id || message?.chat?.id,
        from,
      },
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: "Ticket created from Telegram",
      user: from.first_name || "Telegram User",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Telegram webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/phone
// @desc    Phone/Voice call webhook
// @access  Public
router.post("/phone", async (req: express.Request, res: Response) => {
  try {
    const { calledNumber, callerNumber, transcript, duration } = req.body;

    if (!calledNumber) {
      return res.status(400).json({
        success: false,
        error: "calledNumber is required",
      });
    }

    // Detect tenant from called number
    const tenantId = await detectTenantFromChannel("phone", calledNumber);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant not found for this phone number",
      });
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId);

    // Create ticket
    const ticket = await Ticket.create({
      title: `Phone Call from ${callerNumber || "Unknown"}`,
      description: transcript || "Voice call received",
      priority: "High",
      category: "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customer: callerNumber || "Unknown Caller",
      customerPhone: callerNumber,
      source: "phone",
      channel: "phone",
      metadata: {
        calledNumber,
        callerNumber,
        duration,
        transcript,
      },
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: "Ticket created from phone call",
      user: "System",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Phone webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/contact-form
// @desc    Contact form webhook
// @access  Public
router.post("/contact-form", async (req: express.Request, res: Response) => {
  try {
    const { tenantId: queryTenantId } = req.query;
    const { tenantId: bodyTenantId, name, email, phone, subject, message, priority, category } = req.body;

    const tenantId = queryTenantId || bodyTenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "tenantId is required (as query param or in body)",
      });
    }

    if (!message && !subject) {
      return res.status(400).json({
        success: false,
        error: "Message or subject is required",
      });
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId.toString());

    // Create or find customer
    let customerId;
    if (email || phone) {
      const existingCustomer = await Customer.findOne({
        tenantId: new mongoose.Types.ObjectId(tenantId.toString()),
        $or: [{ email }, { phone }],
      });

      if (existingCustomer) {
        customerId = existingCustomer._id;
      } else {
        const newCustomer = await Customer.create({
          tenantId: new mongoose.Types.ObjectId(tenantId.toString()),
          name: name || email || "Anonymous",
          email,
          phone,
        });
        customerId = newCustomer._id;
      }
    }

    // Create ticket
    const ticket = await Ticket.create({
      title: subject || `Contact Form Submission from ${name || email || "Anonymous"}`,
      description: message || subject,
      priority: priority || "Medium",
      category: category || "general",
      tenantId: new mongoose.Types.ObjectId(tenantId.toString()),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customerId,
      customer: name || email || "Anonymous",
      customerEmail: email,
      customerPhone: phone,
      source: "contact-form",
      channel: "contact-form",
      metadata: {
        submittedAt: new Date().toISOString(),
        referrer: req.headers.referer,
        userAgent: req.headers["user-agent"],
      },
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: "Ticket created from contact form",
      user: name || "Anonymous",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Contact form webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/chatbot
// @desc    Chatbot webhook
// @access  Public
router.post("/chatbot", async (req: express.Request, res: Response) => {
  try {
    const { tenantId: queryTenantId } = req.query;
    const { tenantId: bodyTenantId, message, user, sessionId } = req.body;

    const tenantId = queryTenantId || bodyTenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "tenantId is required (as query param or in body)",
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "message is required",
      });
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId.toString());

    // Create ticket
    const ticket = await Ticket.create({
      title: `Chatbot: ${user || "User"}`,
      description: message,
      priority: detectPriority(message),
      category: "general",
      tenantId: new mongoose.Types.ObjectId(tenantId.toString()),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customer: user || "Chatbot User",
      source: "chatbot",
      channel: "chatbot",
      metadata: {
        sessionId,
        user,
      },
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: "Ticket created from chatbot",
      user: user || "Chatbot User",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Chatbot webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/tenant/:token
// @desc    Tenant-specific universal webhook
// @access  Public
router.post("/tenant/:token", async (req: express.Request, res: Response) => {
  try {
    const { token } = req.params;

    // Detect tenant from token
    const tenantId = await detectTenantFromToken(token);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        error: "Invalid webhook token",
      });
    }

    // Use same logic as universal webhook but with tenantId from token
    const {
      channel,
      source,
      phoneNumber,
      email,
      message,
      subject,
      customerName,
      customerEmail,
      customerPhone,
      priority,
      category,
      metadata = {},
    } = req.body;

    const finalChannel = channel || source || "web";

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId);

    // Create or find customer
    let customerId;
    if (customerEmail || customerPhone || customerName) {
      const existingCustomer = await Customer.findOne({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        $or: [{ email: customerEmail }, { phone: customerPhone }],
      });

      if (existingCustomer) {
        customerId = existingCustomer._id;
      } else {
        const newCustomer = await Customer.create({
          tenantId: new mongoose.Types.ObjectId(tenantId),
          name: customerName || "Unknown",
          email: customerEmail,
          phone: customerPhone,
        });
        customerId = newCustomer._id;
      }
    }

    // Create ticket
    const ticket = await Ticket.create({
      title: subject || `Ticket from ${finalChannel}`,
      description: message || subject || "No description provided",
      priority: priority || detectPriority(message || ""),
      category: category || "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customerId,
      customer: customerName || customerEmail || customerPhone || "Anonymous",
      customerEmail,
      customerPhone,
      source: finalChannel,
      channel: finalChannel,
      metadata,
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: `Ticket created from ${finalChannel}`,
      user: customerName || "System",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Tenant webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// @route   POST /api/webhooks/tenant/:token/:channel
// @desc    Tenant-specific channel webhook
// @access  Public
router.post("/tenant/:token/:channel", async (req: express.Request, res: Response) => {
  try {
    const { token, channel } = req.params;

    // Detect tenant from token
    const tenantId = await detectTenantFromToken(token);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        error: "Invalid webhook token",
      });
    }

    // Process based on channel type
    const {
      message,
      subject,
      customerName,
      customerEmail,
      customerPhone,
      priority,
      category,
      metadata = {},
    } = req.body;

    // Handle channel-specific logic
    let title = "";
    let description = "";

    switch (channel.toLowerCase()) {
      case "whatsapp":
        title = `WhatsApp: ${customerName || req.body.from || "User"}`;
        description = message || req.body.message || "";
        break;
      case "telegram":
        title = `Telegram: ${customerName || req.body.from?.first_name || "User"}`;
        description = message || req.body.message?.text || "";
        break;
      case "phone":
        title = `Phone Call from ${customerPhone || req.body.callerNumber || "Unknown"}`;
        description = message || req.body.transcript || "Voice call received";
        break;
      case "contact-form":
        title = subject || `Contact Form: ${customerName || customerEmail || "Anonymous"}`;
        description = message || "";
        break;
      case "chatbot":
        title = `Chatbot: ${customerName || req.body.user || "User"}`;
        description = message || "";
        break;
      default:
        title = subject || `Ticket from ${channel}`;
        description = message || subject || "No description provided";
    }

    // Auto-assign agent
    const assignedAgentId = await autoAssignAgent(tenantId);

    // Create or find customer
    let customerId;
    if (customerEmail || customerPhone || customerName) {
      const existingCustomer = await Customer.findOne({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        $or: [{ email: customerEmail }, { phone: customerPhone }],
      });

      if (existingCustomer) {
        customerId = existingCustomer._id;
      } else {
        const newCustomer = await Customer.create({
          tenantId: new mongoose.Types.ObjectId(tenantId),
          name: customerName || "Unknown",
          email: customerEmail,
          phone: customerPhone || req.body.from || req.body.callerNumber,
        });
        customerId = newCustomer._id;
      }
    }

    // Create ticket
    const ticket = await Ticket.create({
      title,
      description,
      priority: priority || detectPriority(description),
      category: category || "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customerId,
      customer: customerName || customerEmail || customerPhone || "Anonymous",
      customerEmail,
      customerPhone: customerPhone || req.body.from || req.body.callerNumber,
      source: channel,
      channel: channel,
      metadata: { ...metadata, ...req.body },
    });

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: `Ticket created from ${channel}`,
      user: customerName || "System",
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.status(201).json({
      success: true,
      data: populatedTicket,
      message: `Ticket created and assigned to ${assignedAgentId ? "agent" : "Unassigned"}`,
    });
  } catch (error: any) {
    console.error("Tenant channel webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

export default router;

