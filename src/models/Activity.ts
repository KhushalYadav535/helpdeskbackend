import mongoose, { Document, Schema } from "mongoose";

export interface IActivity extends Document {
  ticketId: mongoose.Types.ObjectId;
  action: string;
  description: string;
  user: string;
  userId?: mongoose.Types.ObjectId;
  timestamp: Date;
  createdAt: Date;
}

const activitySchema = new Schema<IActivity>(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    user: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Activity = mongoose.model<IActivity>("Activity", activitySchema);

