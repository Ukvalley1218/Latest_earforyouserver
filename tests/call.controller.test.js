import {
  getRecentCalls,
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,
  handleMissedCall
} from "../controllers/call.controller.js";

import CallLog from "../models/Talk-to-friend/callLogModel.js";
import createService from "../servises/CallServices.js";
import logger from "../logger/winston.logger.js";

// ---- Mocks ----
jest.mock("../models/Talk-to-friend/callLogModel.js");
jest.mock("../servises/CallServices.js");
jest.mock("../logger/winston.logger.js");

// ---- Helpers ----
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Call Controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================
  // getRecentCalls
  // ============================
  describe("getRecentCalls", () => {
    it("should return 400 if userId is missing", async () => {
      const req = { user: {}, query: {} };
      const res = mockRes();

      await getRecentCalls(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "User ID is required."
      });
    });

    it("should return recent calls successfully", async () => {
      const req = {
        user: { id: "user1" },
        query: { page: 1 }
      };
      const res = mockRes();

      const mockCalls = [
        {
          _id: "call1",
          status: "completed",
          startTime: new Date(),
          endTime: new Date(),
          duration: 120,
          caller: { _id: "user1", username: "A" },
          receiver: { _id: "user2", username: "B" }
        }
      ];

      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockCalls)
      };

      CallLog.find.mockReturnValue(mockQuery);
      CallLog.countDocuments.mockResolvedValue(1);

      await getRecentCalls(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          recentCalls: expect.any(Array),
          totalCalls: 1,
          currentPage: 1
        })
      );
    });

    it("should return 404 if no calls found", async () => {
      const req = {
        user: { id: "user1" },
        query: {}
      };
      const res = mockRes();

      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };

      CallLog.find.mockReturnValue(mockQuery);

      await getRecentCalls(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "No call history found for this page."
      });
    });

    it("should handle server error", async () => {
      const req = {
        user: { id: "user1" },
        query: {}
      };
      const res = mockRes();

      CallLog.find.mockImplementation(() => {
        throw new Error("DB error");
      });

      await getRecentCalls(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ============================
  // initiateCall
  // ============================
  describe("initiateCall", () => {
    it("should return 400 if IDs missing", async () => {
      const req = { body: {} };
      const res = mockRes();

      await initiateCall(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should initiate call successfully", async () => {
      const req = {
        body: { callerId: "1", receiverId: "2" }
      };
      const res = mockRes();

      createService.initiateCall.mockResolvedValue({
        success: true,
        callId: "call123"
      });

      await initiateCall(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it("should return 409 if receiver is busy", async () => {
      const req = {
        body: { callerId: "1", receiverId: "2" }
      };
      const res = mockRes();

      createService.initiateCall.mockResolvedValue({
        success: false,
        message: "Receiver busy"
      });

      await initiateCall(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: "Receiver busy"
      });
    });
  });

  // ============================
  // acceptCall
  // ============================
  describe("acceptCall", () => {
    it("should accept call successfully", async () => {
      const req = {
        body: { callerId: "1", receiverId: "2" }
      };
      const res = mockRes();

      createService.acceptCall.mockResolvedValue({ accepted: true });

      await acceptCall(req, res);

      expect(res.json).toHaveBeenCalledWith({ accepted: true });
    });
  });

  // ============================
  // rejectCall
  // ============================
  describe("rejectCall", () => {
    it("should reject call successfully", async () => {
      const req = {
        body: { callerId: "1", receiverId: "2" }
      };
      const res = mockRes();

      createService.rejectCall.mockResolvedValue({ rejected: true });

      await rejectCall(req, res);

      expect(res.json).toHaveBeenCalledWith({ rejected: true });
    });
  });

  // ============================
  // endCall
  // ============================
  describe("endCall", () => {
    it("should end call successfully", async () => {
      const req = {
        body: { callerId: "1", receiverId: "2" }
      };
      const res = mockRes();

      createService.endCall.mockResolvedValue({ ended: true });

      await endCall(req, res);

      expect(res.json).toHaveBeenCalledWith({ ended: true });
    });
  });

  // ============================
  // handleMissedCall
  // ============================
  describe("handleMissedCall", () => {
    it("should handle missed call successfully", async () => {
      const req = {
        body: { callerId: "1", receiverId: "2" }
      };
      const res = mockRes();

      createService.handleMissedCall.mockResolvedValue({ missed: true });

      await handleMissedCall(req, res);

      expect(res.json).toHaveBeenCalledWith({ missed: true });
    });
  });
});
