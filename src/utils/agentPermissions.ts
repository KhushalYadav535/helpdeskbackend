import { Agent } from "../models/Agent";
import { IUser } from "../models/User";

export type AgentLevel = "agent" | "senior-agent" | "supervisor";

export interface AgentPermissions {
  canViewTickets: boolean;
  canWorkOnTickets: boolean;
  canCloseTickets: boolean;
  canAssignTickets: boolean;
  canTrackAgents: boolean;
  canManageAgents: boolean;
}

/**
 * Get agent level from user
 */
export const getAgentLevel = async (userId: string): Promise<AgentLevel | null> => {
  try {
    const agent = await Agent.findOne({ userId }).select("agentLevel");
    return agent?.agentLevel || null;
  } catch (error) {
    return null;
  }
};

/**
 * Check if agent has permission to perform action
 */
export const hasPermission = async (
  user: IUser,
  permission: keyof AgentPermissions
): Promise<boolean> => {
  // Non-agents or super-admin/tenant-admin don't use agent permissions
  if (user.role !== "agent") {
    return true; // Admin roles have all permissions
  }

  const agentLevel = await getAgentLevel(user._id.toString());
  if (!agentLevel) {
    return false;
  }

  const permissions = getPermissionsForLevel(agentLevel);
  return permissions[permission];
};

/**
 * Get permissions for agent level
 */
export const getPermissionsForLevel = (level: AgentLevel): AgentPermissions => {
  switch (level) {
    case "agent":
      return {
        canViewTickets: true,
        canWorkOnTickets: true,
        canCloseTickets: true,
        canAssignTickets: false,
        canTrackAgents: false,
        canManageAgents: false,
      };

    case "senior-agent":
      return {
        canViewTickets: true,
        canWorkOnTickets: true,
        canCloseTickets: true,
        canAssignTickets: true,
        canTrackAgents: false,
        canManageAgents: false,
      };

    case "supervisor":
      return {
        canViewTickets: true,
        canWorkOnTickets: true,
        canCloseTickets: true,
        canAssignTickets: true,
        canTrackAgents: true,
        canManageAgents: true,
      };

    default:
      return {
        canViewTickets: false,
        canWorkOnTickets: false,
        canCloseTickets: false,
        canAssignTickets: false,
        canTrackAgents: false,
        canManageAgents: false,
      };
  }
};

