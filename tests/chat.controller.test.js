import mongoose from "mongoose";
import {
  markMessageAsRead,
  createOrGetAOneOnOneChat,
  deleteOneOnOneChat,
  searchAvailableUsers,
  getAllChats,
  getUnreadMessagesCount
} from "../controllers/chat.controller.js";

import User from "../models/Users.js";
import { Chat } from "../models/chat.modal.js";
import { ChatMessage } from "../models/message.models.js";
import { emitSocketEvent } from "../socket/index.js";
import { ApiError } from "../utils/ApiError.js";

// ================= MOCKS =================
jest.mock("../models/Users.js");
jest.mock("../models/chat.modal.js");
jest.mock("../models/message.models.js");
jest.mock("../socket/index.js");
jest.mock("../utils/helpers.js", () => ({
  removeLocalFile: jest.fn(),
}));

// asyncHandler mock – passes through
jest.mock("../utils/asyncHandler.js", () => ({
  asyncHandler: (fn) => fn,
}));

// =========================================

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Chat Controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================= markMessageAsRead =================
  describe("markMessageAsRead", () => {
    it("should mark message as read", async () => {
      const req = {
        params: { messageId: "msg1" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      const mockMessage = {
        _id: "msg1",
        seenBy: [],
        isRead: false,
        chat: new mongoose.Types.ObjectId(),
        save: jest.fn()
      };

      ChatMessage.findById.mockResolvedValue(mockMessage);

      await markMessageAsRead(req, res);

      expect(mockMessage.isRead).toBe(true);
      expect(emitSocketEvent).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should throw 404 if message not found", async () => {
      const req = {
        params: { messageId: "msg1" },
        user: { _id: "user1" }
      };

      ChatMessage.findById.mockResolvedValue(null);

      await expect(markMessageAsRead(req, {}))
        .rejects.toThrow(ApiError);
    });
  });

  // ================= searchAvailableUsers =================
  describe("searchAvailableUsers", () => {
    it("should return users excluding logged-in user", async () => {
      const req = { user: { _id: "user1" } };
      const res = mockRes();

      User.aggregate.mockResolvedValue([
        { username: "john", email: "john@test.com" }
      ]);

      await searchAvailableUsers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ================= createOrGetAOneOnOneChat =================
  describe("createOrGetAOneOnOneChat", () => {
    it("should return existing chat", async () => {
      const req = {
        params: { receiverId: "user2" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      User.findById.mockResolvedValue({ _id: "user2" });
      Chat.findOne.mockResolvedValue({ _id: "chat1" });

      await createOrGetAOneOnOneChat(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: { _id: "chat1" }
      });
    });

    it("should throw error if chatting with self", async () => {
      const req = {
        params: { receiverId: "user1" },
        user: { _id: "user1" }
      };

      User.findById.mockResolvedValue({ _id: "user1" });

      await expect(createOrGetAOneOnOneChat(req, {}))
        .rejects.toThrow(ApiError);
    });
  });

  // ================= deleteOneOnOneChat =================
  describe("deleteOneOnOneChat", () => {
    it("should delete chat and emit socket event", async () => {
      const req = {
        params: { chatId: "chat1" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      Chat.aggregate.mockResolvedValue([
        {
          _id: "chat1",
          participants: [{ _id: "user1" }, { _id: "user2" }]
        }
      ]);

      Chat.findByIdAndDelete.mockResolvedValue(true);
      ChatMessage.find.mockResolvedValue([]);
      ChatMessage.deleteMany.mockResolvedValue(true);

      await deleteOneOnOneChat(req, res);

      expect(emitSocketEvent).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ================= getAllChats =================
  describe("getAllChats", () => {
    it("should return user chats", async () => {
      const req = { user: { _id: "user1" } };
      const res = mockRes();

      Chat.aggregate.mockResolvedValue([{ _id: "chat1" }]);

      await getAllChats(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ================= getUnreadMessagesCount =================
  describe("getUnreadMessagesCount", () => {
    it("should return unread count", async () => {
      const req = {
        user: { _id: "user1" },
        query: { otherParticipantId: "user2" }
      };
      const res = mockRes();

      Chat.findOne.mockResolvedValue({ _id: "chat1" });
      ChatMessage.countDocuments.mockResolvedValue(5);

      await getUnreadMessagesCount(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });

    it("should return zero if chat not found", async () => {
      const req = {
        user: { _id: "user1" },
        query: { otherParticipantId: "user2" }
      };
      const res = mockRes();

      Chat.findOne.mockResolvedValue(null);

      await getUnreadMessagesCount(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
