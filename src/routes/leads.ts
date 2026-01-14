import express, { Request, Response } from "express";
import mongoose from "mongoose";
import { Lead } from "../models/Lead";
import { Ticket } from "../models/Ticket";
import { Tenant } from "../models/Tenant";
import { protect, AuthRequest, authorize } from "../middleware/auth";
import { analyzeTranscript } from "../utils/transcriptAnalyzer";
import { detectTenantFromChannel } from "../utils/detectTenant";
import { autoAssignAgent } from "../utils/autoAssignAgent";

const router = express.Router();

// @route   POST /api/leads/migrate-from-tickets
// @desc    Migrate existing phone call tickets to leads
// @access  Private (Admin only)
router.post("/migrate-from-tickets", protect, authorize("super-admin", "tenant-admin"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    // Build query for phone call tickets
    const query: any = {
      $or: [
        { source: "phone" },
        { channel: "phone" },
        { channel: "zoronal" },
      ],
    };

    // Tenant filtering for non-super-admin
    if (user.role !== "super-admin") {
      query.tenantId = user.tenantId;
    }

    // Find all phone call tickets
    const phoneTickets = await Ticket.find(query)
      .populate("tenantId", "name")
      .sort({ created: -1 });

    if (phoneTickets.length === 0) {
      return res.json({
        success: true,
        message: "No phone call tickets found to migrate",
        migrated: 0,
      });
    }

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const ticket of phoneTickets) {
      try {
        // Check if lead already exists for this ticket
        const existingLead = await Lead.findOne({ ticketId: ticket._id });
        if (existingLead) {
          skipped++;
          continue;
        }

        // Extract data from ticket metadata
        const metadata = ticket.metadata || {};
        const transcript = metadata.transcript || ticket.description || "";
        const recording = metadata.recording || metadata.recording_url || null;
        const duration = metadata.duration || 0;
        const callerNumber = ticket.customerPhone || metadata.callerNumber || metadata.phoneNumber || "";
        const calledNumber = metadata.calledNumber || "";
        const callTimestamp = metadata.timestamp 
          ? new Date(metadata.timestamp) 
          : ticket.created;

        // Analyze transcript if available
        let analysisResult = null;
        if (transcript) {
          analysisResult = analyzeTranscript(transcript);
        } else {
          analysisResult = {
            category: "other" as const,
            confidence: 0.3,
            keywords: [],
            sentiment: "neutral" as const,
            intent: "unknown",
            suggestedAction: "Review manually - migrated from ticket",
          };
        }

        // Determine lead type
        const leadType = analysisResult.category;

        // Determine source
        let source: "zoronal" | "phone" | "other" = "phone";
        if (ticket.channel === "zoronal" || metadata.zoronalCallId) {
          source = "zoronal";
        }

        // Create lead
        const lead = await Lead.create({
          source,
          type: leadType,
          status: ticket.status === "Closed" || ticket.status === "Resolved" ? "closed" : "new",
          callerName: ticket.customer || "Unknown",
          callerPhone: callerNumber,
          callerEmail: ticket.customerEmail,
          calledNumber: calledNumber,
          callDuration: duration,
          callRecordingUrl: recording,
          callTranscript: transcript,
          callTimestamp: callTimestamp,
          zoronalCallId: metadata.zoronalCallId || metadata.call_id || undefined,
          zoronalData: source === "zoronal" ? metadata : {},
          analysisResult: analysisResult,
          tenantId: ticket.tenantId,
          ticketId: ticket._id as mongoose.Types.ObjectId,
          ticketCreated: true,
          metadata: {
            migrated: true,
            migratedFrom: "ticket",
            originalTicketId: ticket.ticketId,
            ...metadata,
          },
        });

        migrated++;
      } catch (error: any) {
        errors.push(`Ticket ${ticket.ticketId}: ${error.message}`);
        console.error(`Error migrating ticket ${ticket.ticketId}:`, error);
      }
    }

    res.json({
      success: true,
      message: `Migration completed: ${migrated} leads created, ${skipped} skipped`,
      migrated,
      skipped,
      total: phoneTickets.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/leads
// @desc    Get all leads
// @access  Private
router.get("/", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { type, status, source, tenantId } = req.query;

    // Build query
    const query: any = {};

    // Tenant filtering
    if (user.role === "super-admin") {
      if (tenantId) {
        query.tenantId = new mongoose.Types.ObjectId(tenantId as string);
      }
    } else {
      // Non-super-admin can only see their tenant's leads
      query.tenantId = user.tenantId;
    }

    // Additional filters
    if (type) {
      query.type = type;
    }
    if (status) {
      query.status = status;
    }
    if (source) {
      query.source = source;
    }

    const leads = await Lead.find(query)
      .populate("tenantId", "name")
      .populate("assignedTo", "name email")
      .populate("ticketId", "ticketId title status")
      .sort({ callTimestamp: -1, createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      data: leads,
      count: leads.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/leads/:id
// @desc    Get single lead
// @access  Private
router.get("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("tenantId", "name")
      .populate("assignedTo", "name email")
      .populate("ticketId", "ticketId title status priority");

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    // Check access
    const user = req.user!;
    if (
      user.role !== "super-admin" &&
      lead.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to access this lead",
      });
    }

    res.json({
      success: true,
      data: lead,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   PUT /api/leads/:id
// @desc    Update lead
// @access  Private
router.put("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    // Check access
    const user = req.user!;
    if (
      user.role !== "super-admin" &&
      lead.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this lead",
      });
    }

    // Update lead
    Object.assign(lead, req.body);
    lead.updated = new Date();

    // If assigning, set assignedAt
    if (req.body.assignedTo && !lead.assignedAt) {
      lead.assignedAt = new Date();
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate("tenantId", "name")
      .populate("assignedTo", "name email")
      .populate("ticketId", "ticketId title status");

    res.json({
      success: true,
      data: updatedLead,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/leads/:id/convert-to-ticket
// @desc    Convert lead to ticket
// @access  Private
router.post("/:id/convert-to-ticket", protect, async (req: AuthRequest, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    // Check access
    const user = req.user!;
    if (
      user.role !== "super-admin" &&
      lead.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized",
      });
    }

    // Check if ticket already exists
    if (lead.ticketId) {
      return res.status(400).json({
        success: false,
        error: "Ticket already exists for this lead",
      });
    }

    // Create ticket
    const priority = lead.analysisResult?.sentiment === "negative" ? "High" : "Medium";
    const assignedAgentId = await autoAssignAgent(lead.tenantId.toString(), priority);

    const ticket = await Ticket.create({
      title: `Ticket from Lead ${lead.leadId}: ${lead.callerName || lead.callerPhone || "Unknown"}`,
      description: lead.callTranscript || `Lead converted from ${lead.source} call`,
      priority,
      category: "general",
      tenantId: lead.tenantId,
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      assignedAt: assignedAgentId ? new Date() : undefined,
      customer: lead.callerName || lead.callerPhone || "Unknown",
      customerPhone: lead.callerPhone,
      customerEmail: lead.callerEmail,
      source: "phone",
      channel: lead.source,
      metadata: {
        leadId: lead.leadId,
        zoronalCallId: lead.zoronalCallId,
        recording: lead.callRecordingUrl,
        duration: lead.callDuration,
        transcript: lead.callTranscript,
      },
    });

    // Link ticket to lead
    lead.ticketId = ticket._id as mongoose.Types.ObjectId;
    lead.ticketCreated = true;
    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate("tenantId", "name")
      .populate("assignedTo", "name email")
      .populate("ticketId", "ticketId title status");

    res.json({
      success: true,
      data: updatedLead,
      ticket: ticket,
      message: "Lead converted to ticket successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;
