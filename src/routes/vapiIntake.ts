import express, { Request, Response } from "express";
import mongoose from "mongoose";
import { Ticket } from "../models/Ticket";
import { Lead } from "../models/Lead";
import { Tenant } from "../models/Tenant";
import { autoAssignAgent } from "../utils/autoAssignAgent";

const router = express.Router();

const isObjectId = (value?: string | null) =>
  !!value && mongoose.Types.ObjectId.isValid(value);

const resolveTenantId = async (req: Request): Promise<string | null> => {
  const headerTenant =
    (req.header("X-Tenant-ID") || req.header("x-tenant-id") || "").trim();
  const bodyTenant = (req.body?.tenant_id || req.body?.tenantId || "").trim();
  const tenantHint = headerTenant || bodyTenant;

  if (isObjectId(tenantHint)) {
    return tenantHint;
  }

  if (tenantHint) {
    const tenant = await Tenant.findOne({
      $or: [
        { webhookToken: tenantHint },
        { email: tenantHint.toLowerCase() },
        { name: new RegExp(`^${tenantHint}$`, "i") },
      ],
    }).select("_id");
    if (tenant?._id) {
      return tenant._id.toString();
    }
  }

  const fallbackTenantId = process.env.DEFAULT_TENANT_ID || "";
  if (isObjectId(fallbackTenantId)) {
    return fallbackTenantId;
  }

  const firstActiveTenant = await Tenant.findOne({ status: "active" }).sort({ createdAt: 1 }).select("_id");
  return firstActiveTenant?._id?.toString() || null;
};

const normalizePriority = (priority?: string): "Critical" | "High" | "Medium" | "Low" => {
  const value = (priority || "").trim().toLowerCase();
  if (value === "critical") return "Critical";
  if (value === "high") return "High";
  if (value === "low") return "Low";
  return "Medium";
};

const createUniqueLeadId = () => {
  const stamp = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `LEAD-${stamp}${rand}`;
};

const createLeadWithRetry = async (payload: Record<string, any>, attempts = 3) => {
  let lastError: any;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await Lead.create({
        ...payload,
        leadId: createUniqueLeadId(),
      });
    } catch (error: any) {
      lastError = error;
      const duplicateLeadId =
        error?.code === 11000 &&
        (error?.keyPattern?.leadId || String(error?.message || "").includes("leadId_1"));
      if (!duplicateLeadId || i === attempts - 1) {
        throw error;
      }
    }
  }
  throw lastError;
};

router.post("/complaints", async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Unable to resolve tenant" });
    }

    const payload = req.body || {};
    const assignedAgentId = await autoAssignAgent(tenantId, payload.priority || "Medium");

    const ticket = await Ticket.create({
      title: payload.title || "Complaint from voice call",
      description: payload.description || "No description provided",
      priority: normalizePriority(payload.priority),
      status: payload.status || "Open",
      category: "account",
      tenantId: new mongoose.Types.ObjectId(tenantId),
      agentId: assignedAgentId ? new mongoose.Types.ObjectId(assignedAgentId) : undefined,
      assignedAt: assignedAgentId ? new Date() : undefined,
      customer: payload.customer || "Anonymous",
      customerPhone: payload.customerPhone,
      source: "phone",
      channel: payload.channel || "phone",
      metadata: {
        complaintType: payload.complaint_type,
        rbiCategory: payload.rbi_category,
        language: payload.language,
        ...payload.metadata,
      },
    });

    return res.status(201).json({
      success: true,
      id: ticket.ticketId,
      data: ticket,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

router.post("/service-requests", async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Unable to resolve tenant" });
    }

    const payload = req.body || {};
    const lead = await createLeadWithRetry({
      source: "phone",
      type: "service-request",
      status: "new",
      callerName: payload.customer || "Anonymous",
      callerPhone: payload.customerPhone,
      callTranscript: payload.description || "",
      callTimestamp: payload.metadata?.callTimestamp ? new Date(payload.metadata.callTimestamp) : new Date(),
      tenantId: new mongoose.Types.ObjectId(tenantId),
      metadata: {
        serviceRequestType: payload.sr_type,
        language: payload.language,
        priority: normalizePriority(payload.priority),
        ...payload.metadata,
      },
      notes: payload.title || "Service request created by VAPI workflow",
    });

    return res.status(201).json({
      success: true,
      id: lead.leadId,
      data: lead,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

router.post("/leads", async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Unable to resolve tenant" });
    }

    const payload = req.body || {};
    const lead = await createLeadWithRetry({
      source: "phone",
      type: "sales-lead",
      status: "new",
      callerName: payload.customer || "Anonymous",
      callerPhone: payload.customerPhone,
      callTranscript: payload.description || "",
      callTimestamp: payload.metadata?.callTimestamp ? new Date(payload.metadata.callTimestamp) : new Date(),
      tenantId: new mongoose.Types.ObjectId(tenantId),
      metadata: {
        productInterest: payload.product_interest || "other",
        language: payload.language,
        ...payload.metadata,
      },
      notes: payload.title || "Lead created by VAPI workflow",
    });

    return res.status(201).json({
      success: true,
      id: lead.leadId,
      data: lead,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

router.post("/call-logs", async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Unable to resolve tenant" });
    }

    const payload = req.body || {};
    const callType = payload.call_type === "info" ? "other" : "support";
    const status = payload.resolution === "resolved" ? "closed" : "new";

    const lead = await createLeadWithRetry({
      source: "phone",
      type: callType,
      status,
      callerName: payload.customer || "Anonymous",
      callerPhone: payload.customerPhone,
      callTranscript: payload.description || "",
      callTimestamp: payload.metadata?.callTimestamp ? new Date(payload.metadata.callTimestamp) : new Date(),
      tenantId: new mongoose.Types.ObjectId(tenantId),
      metadata: {
        needsReview: !!payload.needs_review,
        callLogType: payload.call_type,
        language: payload.language,
        ...payload.metadata,
      },
      notes: payload.title || "Call log created by VAPI workflow",
    });

    return res.status(201).json({
      success: true,
      id: lead.leadId,
      data: lead,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

export default router;
