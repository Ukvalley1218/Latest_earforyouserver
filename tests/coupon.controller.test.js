import {
  createCoupon,
  validateCoupon,
  recordUsage,
  getUserCoupons,
  getAllCoupons,
  toggleCouponStatus
} from "../controllers/coupon.controller.js";

import { Coupon, CouponUsage } from "../models/CouponSystem/couponModel.js";

// ---------- Mocks ----------
jest.mock("../models/CouponSystem/couponModel.js");

// ---------- Helpers ----------
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Coupon Controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================= createCoupon =================
  describe("createCoupon", () => {
    it("should create a coupon successfully", async () => {
      const req = {
        user: { _id: "user1", canCreateCoupons: true },
        body: { code: "SAVE10", discountType: "percentage", discountValue: 10 }
      };
      const res = mockRes();

      Coupon.create.mockResolvedValue({ code: "SAVE10" });

      await createCoupon(req, res);

      expect(Coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: "user1",
          ownerType: "user"
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should return 400 on error", async () => {
      const req = {
        user: { _id: "user1", canCreateCoupons: true },
        body: {}
      };
      const res = mockRes();

      Coupon.create.mockRejectedValue(new Error("Validation error"));

      await createCoupon(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ================= validateCoupon =================
  describe("validateCoupon", () => {
    it("should validate percentage coupon", async () => {
      const req = {
        body: { couponCode: "save10", orderAmount: 100 },
        user: { _id: "user1", isStaff: false }
      };
      const res = mockRes();

      Coupon.findOne.mockResolvedValue({
        _id: "c1",
        code: "SAVE10",
        isUsable: true,
        isStaffOnly: false,
        maxUsesPerUser: 5,
        discountType: "percentage",
        discountValue: 10
      });

      CouponUsage.countDocuments.mockResolvedValue(0);

      await validateCoupon(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          discount: 10,
          finalAmount: 90
        })
      );
    });

    it("should fail if coupon not found", async () => {
      const req = {
        body: { couponCode: "INVALID" },
        user: { _id: "user1" }
      };
      const res = mockRes();

      Coupon.findOne.mockResolvedValue(null);

      await validateCoupon(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ================= recordUsage =================
  describe("recordUsage", () => {
    it("should record coupon usage", async () => {
      const req = {
        body: {
          couponId: "c1",
          orderId: "o1",
          discountApplied: 10
        },
        user: { _id: "user1" }
      };
      const res = mockRes();

      CouponUsage.create.mockResolvedValue({ _id: "usage1" });
      Coupon.findByIdAndUpdate.mockResolvedValue(true);

      await recordUsage(req, res);

      expect(CouponUsage.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ================= getUserCoupons =================
  describe("getUserCoupons", () => {
    it("should return available coupons", async () => {
      const req = {
        user: { _id: "user1", isStaff: false }
      };
      const res = mockRes();

      Coupon.find.mockResolvedValue([{ code: "SAVE10" }]);

      await getUserCoupons(req, res);

      expect(Coupon.find).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it("should handle server error", async () => {
      const req = {
        user: { _id: "user1", isStaff: false }
      };
      const res = mockRes();

      Coupon.find.mockRejectedValue(new Error("DB error"));

      await getUserCoupons(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ================= getAllCoupons =================
  describe("getAllCoupons", () => {
    it("should return all coupons", async () => {
      const req = {};
      const res = mockRes();

      Coupon.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue([{ code: "SAVE10" }])
      });

      await getAllCoupons(req, res);

      expect(res.json).toHaveBeenCalled();
    });
  });

  // ================= toggleCouponStatus =================
  describe("toggleCouponStatus", () => {
    it("should toggle coupon status", async () => {
      const req = {
        params: { id: "c1" }
      };
      const res = mockRes();

      const couponMock = {
        isActive: true,
        save: jest.fn()
      };

      Coupon.findById.mockResolvedValue(couponMock);

      await toggleCouponStatus(req, res);

      expect(couponMock.isActive).toBe(false);
      expect(couponMock.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(couponMock);
    });

    it("should return error if coupon not found", async () => {
      const req = {
        params: { id: "c1" }
      };
      const res = mockRes();

      Coupon.findById.mockResolvedValue(null);

      await toggleCouponStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
