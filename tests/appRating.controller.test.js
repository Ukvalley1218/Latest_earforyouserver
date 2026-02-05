import { addRating } from "../controllers/appRating.controller.js";
import AppRating from "../models/LeaderBoard/Apprate.js";

// --------- Mocks ----------
jest.mock("../models/LeaderBoard/Apprate.js");

// --------- Helpers ----------
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("App Rating Controller - addRating", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should add a rating successfully", async () => {
    const req = {
      body: { comment: "Great app!" },
      user: { _id: "user1" }
    };
    const res = mockRes();

    AppRating.findOne.mockResolvedValue(null);

    AppRating.mockImplementation(() => ({
      save: jest.fn().mockResolvedValue(true),
    }));

    await addRating(req, res);

    expect(AppRating.findOne).toHaveBeenCalledWith({ user: "user1" });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Rating added successfully",
        rating: expect.any(Object),
      })
    );
  });

  it("should return 400 if user already rated", async () => {
    const req = {
      body: { comment: "Nice!" },
      user: { _id: "user1" }
    };
    const res = mockRes();

    AppRating.findOne.mockResolvedValue({ _id: "rating1" });

    await addRating(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "You have already rated the app."
    });
  });

  it("should handle server error", async () => {
    const req = {
      body: { comment: "Awesome" },
      user: { _id: "user1" }
    };
    const res = mockRes();

    AppRating.findOne.mockRejectedValue(new Error("DB error"));

    await addRating(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal server error"
    });
  });
});
