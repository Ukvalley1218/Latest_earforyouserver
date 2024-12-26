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

    chat: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
    },
    readBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    seenBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

chatMessageSchema.index({ sender: 1, chat: 1 });

// Index to optimize queries for unread messages in a chat
chatMessageSchema.index({ chat: 1, isRead: 1 });

// Index timestamps for sorting queries
chatMessageSchema.index({ createdAt: -1 });
export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);


