import mongoose, { Document, Schema } from "mongoose";

export interface ITenant extends Document {
  name: string;
  email: string;
  status: "active" | "inactive" | "suspended";
  plan: "free" | "professional" | "enterprise";
  joinDate: Date;
  channels: {
    whatsapp?: string;
    telegram?: string;
    phone?: string;
    email?: string;
  };
  webhookToken: string;
  agents: number;
  customers: number;
  maxAgents?: number;
  ticketTimeout?: number;
  autoAssign?: boolean;
  emailAlerts?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const tenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: [true, "Tenant name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    plan: {
      type: String,
      enum: ["free", "professional", "enterprise"],
      default: "professional",
    },
    joinDate: {
      type: Date,
      default: Date.now,
    },
    channels: {
      whatsapp: { type: String, trim: true },
      telegram: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    webhookToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    agents: {
      type: Number,
      default: 0,
    },
    customers: {
      type: Number,
      default: 0,
    },
    maxAgents: {
      type: Number,
      default: 20,
    },
    ticketTimeout: {
      type: Number,
      default: 48,
    },
    autoAssign: {
      type: Boolean,
      default: true,
    },
    emailAlerts: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Generate webhook token before saving
tenantSchema.pre("save", async function (next) {
  if (!this.webhookToken) {
    this.webhookToken = `wh_tenant_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
  next();
});

export const Tenant = mongoose.model<ITenant>("Tenant", tenantSchema);

