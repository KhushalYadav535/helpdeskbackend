import mongoose, { Document, Schema } from "mongoose";

export interface ICallHistory extends Document {
  historyId: string;
  tenantId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  customer: string;
  customerPhone?: string;
  accountNumber?: string;
  /** Raw intent / channel label from automation (complaint, lead, service_request, troubleshoot, info, …) */
  callType: string;
  resolution: string;
  needsReview: boolean;
  source: string;
  channel: string;
  language?: string;
  metadata?: Record<string, any>;
  callTimestamp?: Date;
  created: Date;
  updated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const callHistorySchema = new Schema<ICallHistory>(
  {
    historyId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    title: { type: String, trim: true, default: "" },
    description: { type: String, default: "" },
    customer: { type: String, trim: true, required: true },
    customerPhone: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    callType: { type: String, trim: true, default: "unknown", index: true },
    resolution: { type: String, trim: true, default: "pending" },
    needsReview: { type: Boolean, default: false },
    source: { type: String, trim: true, default: "phone" },
    channel: { type: String, trim: true, default: "phone" },
    language: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    callTimestamp: { type: Date },
    created: { type: Date, default: Date.now },
    updated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

callHistorySchema.pre("validate", async function (next) {
  if (!this.historyId) {
    const count = await mongoose.model("CallHistory").countDocuments();
    this.historyId = `CALL-${String(count + 1000).padStart(4, "0")}`;
  }
  this.updated = new Date();
  next();
});

callHistorySchema.index({ tenantId: 1, createdAt: -1 });

export const CallHistory = mongoose.model<ICallHistory>("CallHistory", callHistorySchema);
