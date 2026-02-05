import mongoose from "mongoose";
import {
  getAllMessages,
  sendMessage,
  deleteMessage
} from "../controllers/message.controller.js";

import { Chat } from "../models/chat.modal.js";
import { ChatMessage } from "../models/message.models.js";
import User from "../models/Users.js";
import { emitSocketEvent } from "../socket/index.js";
import admin from "../config/firebaseConfig.js";
import { ApiError } from "../utils/ApiError.js";

// ================= MOCKS =================
jest.mock("../models/chat.modal.js");
jest.mock("../models/message.models.js");
jest.mock("../models/Users.js");
jest.mock("../socket/index.js");
jest.mock("../config/firebaseConfig.js", () => ({
  messaging: () => ({
    send: jest.fn(),
  }),
}));

jest.mock("../utils/helpers.js", () => ({
  getLocalPath: jest.fn(() => "/local/file"),
  getStaticFilePath: jest.fn(() => "/static/file"),
  removeLocalFile: jest.fn(),
}));

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

describe("Message Controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================= getAllMessages =================
  describe("getAllMessages", () => {
    it("should return messages successfully", async () => {
      const req = {
        params: { chatId: "chat1" },
        query: { page: 1, limit: 10 },
        user: { _id: "user1" }
      };
      const res = mockRes();

      Chat.findById.mockResolvedValue({
        _id: "chat1",
        participants: ["user1"]
      });

      ChatMessage.aggregate.mockResolvedValue([
        { content: "Hello" }
      ]);

      await getAllMessages(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });

    it("should throw error if chat does not exist", async () => {
      const req = {
        params: { chatId: "chat1" },
        user: { _id: "user1" }
      };

      Chat.findById.mockResolvedValue(null);

      await expect(getAllMessages(req, {}))
        .rejects.toThrow(ApiError);
    });
  });

  // ================= sendMessage =================
  describe("sendMessage", () => {
    it("should send message successfully", async () => {
      const req = {
        params: { chatId: "chat1" },
        body: { content: "Hi" },
        user: { _id: "user1" },
        files: {}
      };
      const res = mockRes();

      Chat.findOne.mockResolvedValue({
        _id: "chat1",
        participants: [
          { _id: "user1" },
          { _id: "user2" }
        ]
      });

      ChatMessage.create.mockResolvedValue({
        _id: "msg1"
      });

      Chat.findByIdAndUpdate.mockResolvedValue(true);

      ChatMessage.aggregate.mockResolvedValue([
        { _id: "msg1", content: "Hi" }
      ]);

      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          name: "John",
          username: "john",
          avatarUrl: "img.png",
          deviceToken: "token123"
        })
      });

      await sendMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(emitSocketEvent).toHaveBeenCalled();
    });

    it("should throw error if message content missing", async () => {
      const req = {
        params: { chatId: "chat1" },
        body: {},
        user: { _id: "user1" }
      };

      await expect(sendMessage(req, {}))
        .rejects.toThrow(ApiError);
    });
  });

  // ================= deleteMessage =================
  describe("deleteMessage", () => {
    it("should delete message successfully", async () => {
      const req = {
        params: { chatId: "chat1", messageId: "msg1" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      Chat.findOne.mockResolvedValue({
        _id: "chat1",
        participants: ["user1", "user2"],
        lastMessage: "msg1"
      });

      ChatMessage.findOne.mockResolvedValue({
        _id: "msg1",
        sender: "user1",
        attachments: [],
      });

      ChatMessage.deleteOne.mockResolvedValue(true);
      ChatMessage.findOne.mockResolvedValueOnce(null);
      Chat.findByIdAndUpdate.mockResolvedValue(true);

      await deleteMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(emitSocketEvent).toHaveBeenCalled();
    });

    it("should throw error if user is not sender", async () => {
      const req = {
        params: { chatId: "chat1", messageId: "msg1" },
        user: { _id: "user1" }
      };

      Chat.findOne.mockResolvedValue({
        _id: "chat1",
        participants: ["user1"]
      });

      ChatMessage.findOne.mockResolvedValue({
        _id: "msg1",
        sender: "user2",
        attachments: []
      });

      await expect(deleteMessage(req, {}))
        .rejects.toThrow(ApiError);
    });
  });
});
