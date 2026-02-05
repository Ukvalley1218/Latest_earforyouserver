import {
  blockUser,
  unblockUser,
  checkBlockStatus,
  getBlockedUsers
} from "../controllers/block.controller.js";

import Block from "../models/Block.js";
import User from "../models/Users.js";

// Mock Mongoose models
jest.mock("../models/Block.js");
jest.mock("../models/Users.js");

// Helper to mock res object
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Block Controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("blockUser", () => {
    it("should block a user successfully", async () => {
      const req = {
        body: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      User.findById
        .mockResolvedValueOnce({ _id: "1" }) // blocker
        .mockResolvedValueOnce({ _id: "2" }); // blocked

      Block.findOne.mockResolvedValue(null);

      Block.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(true),
      }));

      await blockUser(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "User blocked successfully",
        })
      );
    });

    it("should return 404 if user not found", async () => {
      const req = {
        body: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      User.findById.mockResolvedValue(null);

      await blockUser(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "User not found" });
    });

    it("should return 400 if already blocked", async () => {
      const req = {
        body: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      User.findById
        .mockResolvedValueOnce({ _id: "1" })
        .mockResolvedValueOnce({ _id: "2" });

      Block.findOne.mockResolvedValue({ _id: "block123" });

      await blockUser(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "User is already blocked"
      });
    });

    it("should handle server error", async () => {
      const req = { body: {} };
      const res = mockRes();

      User.findById.mockRejectedValue(new Error("DB error"));

      await blockUser(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Error blocking user"
        })
      );
    });
  });

  describe("unblockUser", () => {
    it("should unblock user successfully", async () => {
      const req = {
        body: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      Block.findOneAndDelete.mockResolvedValue({ _id: "block123" });

      await unblockUser(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "User unblocked successfully"
        })
      );
    });

    it("should return 404 if block not found", async () => {
      const req = {
        body: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      Block.findOneAndDelete.mockResolvedValue(null);

      await unblockUser(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Block relationship not found"
      });
    });
  });

  describe("checkBlockStatus", () => {
    it("should return isBlocked true", async () => {
      const req = {
        query: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      Block.findOne.mockResolvedValue({ _id: "block123" });

      await checkBlockStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        isBlocked: true,
        block: { _id: "block123" }
      });
    });

    it("should return isBlocked false", async () => {
      const req = {
        query: { blockerId: "1", blockedId: "2" }
      };
      const res = mockRes();

      Block.findOne.mockResolvedValue(null);

      await checkBlockStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        isBlocked: false,
        block: null
      });
    });
  });

  describe("getBlockedUsers", () => {
    it("should return blocked users list", async () => {
      const req = {
        params: { userId: "1" }
      };
      const res = mockRes();

      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([
          { blocked: { username: "john", email: "john@test.com" } }
        ])
      };

      Block.find.mockReturnValue(mockQuery);

      await getBlockedUsers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            blocked: expect.objectContaining({
              username: "john"
            })
          })
        ])
      );
    });
  });
});
