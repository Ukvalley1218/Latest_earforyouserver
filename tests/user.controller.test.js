import axios from "axios";
import mongoose from "mongoose";
import {
  getUsersByServiceType,
  getUserById,
  filterByReview
} from "../controllers/user.controller.js";

import User from "../models/Users.js";
import Review from "../models/LeaderBoard/Review.js";

// ---------------- MOCKS ----------------
jest.mock("axios");
jest.mock("../models/Users.js");
jest.mock("../models/LeaderBoard/Review.js");

// ---------------- HELPERS ----------------
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("User Controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================= getUsersByServiceType =================
  describe("getUsersByServiceType", () => {
    it("should return 400 for invalid serviceType", async () => {
      const req = {
        query: { serviceType: "Invalid" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      await getUsersByServiceType(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return users via aggregation when address not provided", async () => {
      const req = {
        query: { serviceType: "Mechanic", page: 1, limit: 10 },
        user: { _id: new mongoose.Types.ObjectId() }
      };
      const res = mockRes();

      User.aggregate.mockResolvedValue([
        { _id: "u1", averageRating: 4.5, userRating: [] }
      ]);

      await getUsersByServiceType(req, res);

      expect(User.aggregate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          users: expect.any(Array)
        })
      );
    });

    it("should return 500 on unexpected error", async () => {
      const req = {
        query: { serviceType: "Mechanic" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      User.aggregate.mockRejectedValue(new Error("DB error"));

      await getUsersByServiceType(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ================= getUserById =================
  describe("getUserById", () => {
    it("should return 400 if ID is missing", async () => {
      const req = { params: {} };
      const res = mockRes();

      await getUserById(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 for invalid ObjectId", async () => {
      const req = { params: { id: "invalid-id" } };
      const res = mockRes();

      await getUserById(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return user successfully", async () => {
      const userId = new mongoose.Types.ObjectId();
      const req = { params: { id: userId.toString() } };
      const res = mockRes();

      User.findById.mockResolvedValue({ _id: userId });

      await getUserById(req, res);

      expect(User.findById).toHaveBeenCalledWith(userId.toString());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 if user not found", async () => {
      const userId = new mongoose.Types.ObjectId();
      const req = { params: { id: userId.toString() } };
      const res = mockRes();

      User.findById.mockResolvedValue(null);

      await getUserById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ================= filterByReview =================
  describe("filterByReview", () => {
    it("should return 400 if no filters provided", async () => {
      const req = { query: {} };
      const res = mockRes();

      await filterByReview(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return filtered reviews successfully", async () => {
      const req = {
        query: {
          ratingCategory: "high",
          page: 1,
          limit: 10
        }
      };
      const res = mockRes();

      Review.countDocuments.mockResolvedValue(1);

      Review.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: "r1",
            rating: 5,
            comment: "Great",
            user: { serviceType: "Mechanic", companyAddress: "NY" }
          }
        ])
      });

      await filterByReview(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array)
        })
      );
    });

    it("should return 404 if no reviews after filtering", async () => {
      const req = {
        query: { ratingCategory: "low" }
      };
      const res = mockRes();

      Review.countDocuments.mockResolvedValue(0);

      Review.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      });

      await filterByReview(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
