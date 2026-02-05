import {
  expirePlatformCharges,
  scheduleNextRun
} from "../controllers/expiry/platformCharges.expiry.js";

import PlatformCharges from "../models/Wallet/PlatfromCharges/Platfrom.js";

// --------- Mocks ----------
jest.mock("../models/Wallet/PlatfromCharges/Platfrom.js");

// Use fake timers for scheduling
jest.useFakeTimers();

// --------- Helpers ----------
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Platform Charges Expiry", () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  // ================= expirePlatformCharges =================
  describe("expirePlatformCharges", () => {
    it("should activate and expire platform charges successfully", async () => {
      const req = {};
      const res = mockRes();

      PlatformCharges.updateMany
        .mockResolvedValueOnce({ modifiedCount: 2 }) // activate
        .mockResolvedValueOnce({ modifiedCount: 1 }); // expire

      await expirePlatformCharges(req, res);

      expect(PlatformCharges.updateMany).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Success ",
          activateResult: { modifiedCount: 2 },
          expireResult: { modifiedCount: 1 }
        })
      );
    });

    it("should handle errors gracefully", async () => {
      const req = {};
      const res = mockRes();

      PlatformCharges.updateMany.mockRejectedValue(
        new Error("DB failure")
      );

      await expirePlatformCharges(req, res);

      expect(PlatformCharges.updateMany).toHaveBeenCalled();
      // No response sent on error (as per controller)
    });
  });

  // ================= scheduleNextRun =================
  describe("scheduleNextRun", () => {
    it("should schedule updatePlatformCharges using setTimeout", () => {
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      scheduleNextRun();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

      const delay = setTimeoutSpy.mock.calls[0][1];
      expect(typeof delay).toBe("number");
      expect(delay).toBeGreaterThan(0);
    });

    it("should schedule for tomorrow if time already passed", () => {
      // Mock system time to after 11:59 PM
      jest.setSystemTime(
        new Date("2026-01-16T23:59:30.000Z")
      );

      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      scheduleNextRun();

      const delay = setTimeoutSpy.mock.calls[0][1];
      expect(delay).toBeGreaterThan(0);
    });
  });
});
