import express, { Response } from "express";
import { Ticket } from "../models/Ticket";
import { Customer } from "../models/Customer";
import { Activity } from "../models/Activity";
import { Agent } from "../models/Agent";
import { User } from "../models/User";
import { Lead } from "../models/Lead";
import { detectTenantFromChannel, detectTenantFromToken } from "../utils/detectTenant";
import { autoAssignAgent } from "../utils/autoAssignAgent";
import { emailService } from "../utils/emailService";
import { analyzeTranscript } from "../utils/transcriptAnalyzer";
import mongoose from "mongoose";

const router = express.Router();

// Helper function to update agent statistics when ticket is assigned
const updateAgentStats = async (agentId: string | undefined | null, incrementAssigned = false) => {
  if (!agentId) return;
  try {
    const agent = await Agent.findOne({ userId: new mongoose.Types.ObjectId(agentId) });
    if (agent) {
      if (incrementAssigned) {
        agent.ticketsAssigned = (agent.ticketsAssigned || 0) + 1;
      }
      await agent.save();
    }
  } catch (error) {
    console.error("Error updating agent stats:", error);
  }
};

// Helper function to normalize priority string to enum
const normalizePriority = (priority: string | undefined): "Critical" | "High" | "Medium" | "Low" => {
  if (!priority) return "Medium";
  const p = priority.trim();
  const lower = p.toLowerCase();
  if (lower === "critical" || lower === "urgent") return "Critical";
  if (lower === "high" || lower === "3") return "High";
  if (lower === "medium" || lower === "med" || lower === "2") return "Medium";
  if (lower === "low" || lower === "1") return "Low";
  return "Medium";
};

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

    // Detect priority before assignment
    const finalPriority = priority || detectPriority(message || "");

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(finalTenantId, finalPriority);

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
      priority: finalPriority,
      category: category || "general",
      tenantId: new mongoose.Types.ObjectId(finalTenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      assignedAt: assignedAgentId ? new Date() : undefined,
      customerId,
      customer: customerName || customerEmail || customerPhone || "Anonymous",
      customerEmail,
      customerPhone,
      source: finalChannel,
      channel: finalChannel,
      metadata,
    });

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

    // Detect priority
    const ticketPriority = detectPriority(message);

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(tenantId, ticketPriority);

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
      priority: ticketPriority,
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

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

    // Detect priority
    const ticketPriority = detectPriority(msg);

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(tenantId, ticketPriority);

    // Create ticket
    const ticket = await Ticket.create({
      title: `Telegram: ${from.first_name || from.username || "User"}`,
      description: msg,
      priority: ticketPriority,
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

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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
    const {
      calledNumber,
      callerNumber,
      callerName,
      callerEmail,
      transcript,
      duration,
      recording,
      timestamp,
    } = req.body;

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

    // Phone calls are high priority by default
    const ticketPriority: "High" = "High";

    // Auto-assign agent based on priority (High → Senior Agents or Supervisors)
    const assignedAgentId = await autoAssignAgent(tenantId, ticketPriority);

    // Create ticket
    const ticket = await Ticket.create({
      title: `Phone Call from ${callerNumber || "Unknown"}`,
      description: transcript || "Voice call received",
      priority: ticketPriority,
      category: "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customer: callerName || callerNumber || "Unknown Caller",
      customerPhone: callerNumber,
      customerEmail: callerEmail,
      source: "phone",
      channel: "phone",
      metadata: {
        calledNumber,
        callerNumber,
        duration,
        transcript,
        recording,
        timestamp,
      },
    });

    // Create Lead as well so Call History shows the call (Call History reads from Leads)
    const analysisResult = transcript
      ? analyzeTranscript(transcript)
      : {
          category: "other" as const,
          confidence: 0.3,
          keywords: [] as string[],
          sentiment: "neutral" as const,
          intent: "unknown",
          suggestedAction: "Review manually - phone call",
        };

    await Lead.create({
      source: "phone",
      type: analysisResult.category,
      status: "new",
      callerName: callerName || callerNumber || "Unknown",
      callerPhone: callerNumber,
      callerEmail: callerEmail,
      calledNumber: calledNumber,
      callDuration: duration,
      callRecordingUrl: recording,
      callTranscript: transcript || "Voice call received",
      callTimestamp: timestamp ? new Date(timestamp) : ticket.created,
      tenantId: new mongoose.Types.ObjectId(tenantId),
      ticketId: ticket._id as mongoose.Types.ObjectId,
      ticketCreated: true,
      analysisResult,
      metadata: {
        migratedFrom: "phone-webhook",
        calledNumber,
        callerNumber,
      },
    });

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

    // Determine priority
    const ticketPriority = priority || "Medium";

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(tenantId.toString(), ticketPriority);

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
      priority: ticketPriority,
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

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

    // Detect priority
    const ticketPriority = detectPriority(message);

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(tenantId.toString(), ticketPriority);

    // Create ticket
    const ticket = await Ticket.create({
      title: `Chatbot: ${user || "User"}`,
      description: message,
      priority: ticketPriority,
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

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

    // Detect priority
    const finalPriority = priority || detectPriority(message || "");

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(tenantId, finalPriority);

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
      priority: finalPriority,
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

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

    // Process based on channel type (n8n sends "customer", some send "customerName")
    const {
      message,
      subject,
      description: bodyDescription,
      customer: bodyCustomer,
      customerName: bodyCustomerName,
      customerEmail,
      customerPhone,
      priority,
      category,
      metadata = {},
    } = req.body;
    const customerName = bodyCustomerName || bodyCustomer || req.body.customerName || req.body.customer;

    // Handle channel-specific logic
    let title = "";
    let description = "";

    switch (channel.toLowerCase()) {
      case "whatsapp":
        title = `WhatsApp: ${customerName || req.body.from || "User"}`;
        description = message || bodyDescription || req.body.message || req.body.text || "";
        break;
      case "telegram":
        title = `Telegram: ${customerName || req.body.from?.first_name || "User"}`;
        description = message || bodyDescription || req.body.message?.text || req.body.text || "";
        break;
      case "phone":
        title = `Phone Call from ${customerName || customerPhone || req.body.callerNumber || "Unknown"}`;
        description = message || bodyDescription || req.body.transcript || req.body.message || "Voice call received";
        break;
      case "email":
        // Expecting fields: subject, message/body, from/email
        title = subject || `Email from ${customerEmail || req.body.from || "Customer"}`;
        description = message || bodyDescription || req.body.body || req.body.text || "";
        break;
      case "slack":
        // Expecting fields: channel, user, text
        title = `Slack: ${req.body.channel || customerName || req.body.user || "Message"}`;
        description = message || bodyDescription || req.body.text || req.body.body || "";
        break;
      case "contact-form":
        title = subject || `Contact Form: ${customerName || customerEmail || "Anonymous"}`;
        description = message || bodyDescription || req.body.text || req.body.body || subject || "";
        break;
      case "chatbot":
        title = `Chatbot: ${customerName || req.body.user || "User"}`;
        description = message || bodyDescription || req.body.text || req.body.body || "";
        break;
      default:
        title = subject || `Ticket from ${channel}`;
        description = message || bodyDescription || subject || req.body.text || req.body.body || "";
    }

    const normalizedDescription = (description || bodyDescription || subject || "").toString().trim();

    if (!normalizedDescription) {
      return res.status(400).json({
        success: false,
        error: "Description is required",
      });
    }

    const normalizedTitle = (title || subject || `Ticket from ${channel}`).toString().trim() || `Ticket from ${channel}`;

    // Normalize and detect priority
    const finalPriority = priority ? normalizePriority(priority) : detectPriority(normalizedDescription);

    // Auto-assign agent based on priority
    const assignedAgentId = await autoAssignAgent(tenantId, finalPriority);

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
      title: normalizedTitle,
      description: normalizedDescription,
      priority: finalPriority,
      category: category || "general",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      customerId,
      customer: customerName || customerEmail || customerPhone || req.body.customer || "Anonymous",
      customerEmail,
      customerPhone: customerPhone || req.body.from || req.body.callerNumber,
      source: channel,
      channel: channel,
      metadata: { ...metadata, ...req.body },
    });

    // Update agent statistics
    await updateAgentStats(assignedAgentId, true);

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

// @route   POST /api/webhooks/zoronal
// @desc    Zoronal webhook - receive call data and create lead
// @access  Public (webhook)
router.post("/zoronal", async (req: express.Request, res: Response) => {
  try {
    const zoronalData = req.body;

    // Extract call data from Zoronal webhook
    const {
      call_id,
      caller_number,
      called_number,
      caller_name,
      caller_email,
      duration,
      recording_url,
      transcript,
      timestamp,
      call_status,
      call_type,
      agent_name,
      ...otherData
    } = zoronalData;

    if (!call_id) {
      return res.status(400).json({
        success: false,
        error: "call_id is required",
      });
    }

    // Check if lead already exists (prevent duplicates)
    const existingLead = await Lead.findOne({ zoronalCallId: call_id });
    if (existingLead) {
      return res.json({
        success: true,
        message: "Lead already exists",
        data: existingLead,
      });
    }

    // Detect tenant from called number
    let tenantId: string | null = null;
    if (called_number) {
      tenantId = await detectTenantFromChannel("phone", called_number);
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant not found for this phone number. Please configure phone number in tenant settings.",
      });
    }

    // Analyze transcript if available
    let analysisResult = null;
    if (transcript) {
      analysisResult = analyzeTranscript(transcript);
    } else {
      // Default analysis if no transcript
      analysisResult = {
        category: "other" as const,
        confidence: 0.3,
        keywords: [],
        sentiment: "neutral" as const,
        intent: "unknown",
        suggestedAction: "Review manually - no transcript available",
      };
    }

    // Determine lead type from analysis
    const leadType = analysisResult.category;

    // Create lead
    const lead = await Lead.create({
      source: "zoronal",
      type: leadType,
      status: "new",
      callerName: caller_name,
      callerPhone: caller_number,
      callerEmail: caller_email,
      calledNumber: called_number,
      callDuration: duration,
      callRecordingUrl: recording_url,
      callTranscript: transcript,
      callTimestamp: timestamp ? new Date(timestamp) : new Date(),
      zoronalCallId: call_id,
      zoronalData: zoronalData, // Store complete payload
      analysisResult: analysisResult,
      tenantId: new mongoose.Types.ObjectId(tenantId),
      metadata: {
        call_status,
        call_type,
        agent_name,
        ...otherData,
      },
    });

    // Auto-create ticket if it's a service request or support
    let ticket = null;
    if (leadType === "service-request" || leadType === "support") {
      const priority = analysisResult.sentiment === "negative" ? "High" : "Medium";
      const assignedAgentId = await autoAssignAgent(tenantId, priority);

      ticket = await Ticket.create({
        title: `Service Request from ${caller_name || caller_number || "Unknown"}`,
        description: transcript || `Call received from ${caller_number || "Unknown"}`,
        priority,
        category: "general",
        tenantId: new mongoose.Types.ObjectId(tenantId),
        agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
        assignedAt: assignedAgentId ? new Date() : undefined,
        customer: caller_name || caller_number || "Unknown Caller",
        customerPhone: caller_number,
        source: "phone",
        channel: "zoronal",
        metadata: {
          leadId: lead.leadId,
          zoronalCallId: call_id,
          recording: recording_url,
          duration,
          transcript,
        },
      });

      // Link ticket to lead
      lead.ticketId = ticket._id as mongoose.Types.ObjectId;
      lead.ticketCreated = true;
      await lead.save();
    }

    // Populate lead data
    const populatedLead = await Lead.findById(lead._id)
      .populate("tenantId", "name")
      .populate("assignedTo", "name email")
      .populate("ticketId", "ticketId title status");

    res.status(201).json({
      success: true,
      data: populatedLead,
      ticketCreated: ticket ? true : false,
      ticketId: ticket?._id,
      message: leadType === "sales-lead"
        ? "Lead created. Assign to sales team."
        : "Lead and ticket created successfully.",
    });
  } catch (error: any) {
    console.error("Zoronal webhook error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

export default router;

