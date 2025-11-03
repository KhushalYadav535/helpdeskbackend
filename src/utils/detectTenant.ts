import { Tenant } from "../models/Tenant";

// Normalize phone number for comparison
export const normalizePhone = (phone: string): string => {
  return phone.replace(/[\s\-\(\)\+]/g, "").replace(/^91/, "").replace(/^0/, "");
};

// Detect tenant from channel/identifier
export const detectTenantFromChannel = async (
  channel: string,
  identifier: string
): Promise<string | null> => {
  const normalizedId = identifier.trim().toLowerCase();

  const tenants = await Tenant.find({ status: "active" });

  for (const tenant of tenants) {
    if (!tenant.channels) continue;

    const channels = tenant.channels as any;

    switch (channel.toLowerCase()) {
      case "whatsapp":
      case "phone":
        const tenantPhone = channels.whatsapp || channels.phone;
        if (
          tenantPhone &&
          normalizePhone(tenantPhone) === normalizePhone(normalizedId)
        ) {
          return tenant._id.toString();
        }
        break;

      case "telegram":
        if (
          channels.telegram &&
          channels.telegram.toLowerCase() === normalizedId
        ) {
          return tenant._id.toString();
        }
        break;

      case "email":
        if (
          channels.email &&
          (channels.email.toLowerCase() === normalizedId ||
            channels.email.toLowerCase().split("@")[1] ===
              normalizedId.split("@")[1])
        ) {
          return tenant._id.toString();
        }
        break;
    }
  }

  return null;
};

// Detect tenant from webhook token
export const detectTenantFromToken = async (
  token: string
): Promise<string | null> => {
  const tenant = await Tenant.findOne({ webhookToken: token, status: "active" });
  return tenant ? tenant._id.toString() : null;
};

