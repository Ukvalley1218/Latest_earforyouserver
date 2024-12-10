import mongoose, { Schema } from "mongoose";

// TODO: Add image and pdf file sharing in the next version
const chatMessageSchema = new Schema(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    content: {
      type: String,
    },
    attachments: {
      type: [
        {
          url: String,
          localPath: String,
        },
      ],
      default: [],
    },
    call: [
      {
        caller: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        receiver: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        startTime: {
          type: Date,
          default: Date.now
        },
        endTime: {
          type: Date
        },
        duration: {
          type: Number
        }, // Duration in seconds
        status: {
          type: String,
          enum: ['completed', 'missed', 'failed', 'rejected']
        },
      },
    ],





    chat: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
    },
  },
  { timestamps: true }
);

export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);
