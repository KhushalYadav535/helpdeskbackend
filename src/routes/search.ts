import express, { Response } from "express";
import { Ticket } from "../models/Ticket";
import { protect, AuthRequest } from "../middleware/auth";

const router = express.Router();

function dashBase(role: string): string {
  switch (role) {
    case "tenant-admin":
      return "/dashboard/tenant-admin";
    case "super-admin":
      return "/dashboard/super-admin";
    case "customer":
      return "/dashboard/customer";
    default:
      return "/dashboard/agent";
  }
}

function staticPagesForRole(role: string) {
  const b = dashBase(role);
  return [
    { id: "s-1", title: "Profile Settings", subtitle: "Settings", category: "settings" as const, url: `${b}/settings` },
    { id: "s-2", title: "Notification Preferences", subtitle: "Settings", category: "settings" as const, url: `${b}/settings` },
    { id: "s-3", title: "Work Preferences", subtitle: "Settings", category: "settings" as const, url: `${b}/settings` },
    { id: "s-4", title: "Tickets", subtitle: "Dashboard", category: "settings" as const, url: `${b}/tickets` },
    { id: "s-5", title: "Leads", subtitle: "Dashboard", category: "settings" as const, url: `${b}/leads` },
    { id: "s-6", title: "Call Logs", subtitle: "Dashboard", category: "settings" as const, url: `${b}/call-logs` },
    { id: "kb-1", title: "Knowledge Base", subtitle: "Help", category: "knowledge-base" as const, url: "/dashboard/customer/kb" },
  ];
}

/**
 * @route GET /api/search?q=
 * @desc Live search: tickets (tenant-scoped) + static pages
 */
router.get("/", protect, async (req: AuthRequest, res: Response) => {
  try {
    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) {
      return res.json({
        success: true,
        data: { tickets: [], settings: [], knowledgeBase: [] },
      });
    }

    const user = req.user!;
    const tenantFilter =
      user.role === "super-admin"
        ? {}
        : { tenantId: user.tenantId };

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const ticketQuery: any = {
      ...tenantFilter,
      $or: [{ title: rx }, { description: rx }, { ticketId: rx }, { customer: rx }],
    };

    const ticketDocs = await Ticket.find(ticketQuery)
      .sort({ created: -1 })
      .limit(15)
      .select("ticketId title status priority customer created")
      .lean();

    const b = dashBase(user.role);
    const tickets = ticketDocs.map((t: any) => ({
      id: t._id.toString(),
      title: t.title || "Ticket",
      subtitle: `${t.status || "Open"} · ${t.ticketId || t._id}`,
      category: "tickets" as const,
      url: `${b}/tickets`,
    }));

    const STATIC_PAGES = staticPagesForRole(user.role);
    const staticMatches = STATIC_PAGES.filter(
      (p) => p.title.toLowerCase().includes(q.toLowerCase()) || p.subtitle.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 6);

    const settings = staticMatches.filter((p) => p.category === "settings");
    const knowledgeBase = staticMatches.filter((p) => p.category === "knowledge-base");

    res.json({
      success: true,
      data: {
        tickets: tickets.slice(0, 10),
        settings: settings.map((p) => ({ ...p, category: "settings" })),
        knowledgeBase: knowledgeBase.map((p) => ({ ...p, category: "knowledge-base" })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

export default router;
