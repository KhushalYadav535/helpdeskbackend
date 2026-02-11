import { Agent } from "../models/Agent";
import { Ticket } from "../models/Ticket";
import mongoose from "mongoose";

export const autoAssignAgent = async (
  tenantId: string,
  priority?: "Critical" | "High" | "Medium" | "Low"
): Promise<string | null> => {
  // Get all agents for this tenant
  const tenantAgents = await Agent.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).populate("userId", "name email");

  if (tenantAgents.length === 0) {
    return null;
  }

  // Treat all agents as available (always-online behavior)
  const availableAgents = tenantAgents;

  if (availableAgents.length === 0) {
    // If no online agents, assign to any agent
    return tenantAgents[0].userId._id.toString();
  }

  // Get current ticket counts for load balancing (only count active/open tickets)
  const ticketCounts: Record<string, number> = {};

  // Count only unresolved tickets (Open, In Progress, etc.) - exclude Resolved and Closed
  const unresolvedTickets = await Ticket.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    status: { $nin: ["Resolved", "Closed"] }, // Only count active tickets
    agentId: { $exists: true },
  });

  // Initialize all candidate agents with 0 tickets
  for (const agent of availableAgents) {
    const agentIdStr = agent.userId._id.toString();
    ticketCounts[agentIdStr] = 0;
  }

  // Count tickets per agent
  for (const ticket of unresolvedTickets) {
    if (ticket.agentId) {
      const agentIdStr = ticket.agentId.toString();
      ticketCounts[agentIdStr] = (ticketCounts[agentIdStr] || 0) + 1;
    }
  }

  // Priority-based assignment - Supervisors are NEVER auto-assigned (they do manual assign/transfer only)
  // Exclude supervisors from auto-assignment pool
  const assignableAgents = availableAgents.filter((a) => a.agentLevel !== "supervisor" && a.agentLevel !== "management");

  let candidateAgents: typeof availableAgents = [];

  if (priority === "Critical") {
    // Critical → Senior Agents only (distributed), NOT supervisors
    candidateAgents = assignableAgents.filter((a) => a.agentLevel === "senior-agent");
  } else {
    // Medium, Low, High → Agents (and Senior Agents for load balance), distributed
    candidateAgents = assignableAgents.filter((a) => a.agentLevel === "agent" || a.agentLevel === "senior-agent");
  }

  // If no candidate agents found (for High/Critical), return null (unassigned)
  if (candidateAgents.length === 0) {
    return null;
  }

  // Load balancing: Assign to agent with least open tickets
  // Find agent with minimum ticket count
  let selectedAgent = candidateAgents[0];
  let minTickets = ticketCounts[selectedAgent.userId._id.toString()] || 0;

  for (const agent of candidateAgents) {
    const agentIdStr = agent.userId._id.toString();
    const count = ticketCounts[agentIdStr] || 0;
    
    // Select agent with fewer tickets
    if (count < minTickets) {
      minTickets = count;
      selectedAgent = agent;
    }
  }

  // Return the agent with least tickets (if multiple have same count, returns first one)
  return selectedAgent.userId._id.toString();
};

