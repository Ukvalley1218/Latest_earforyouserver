import { getAllAgents } from "../controllers/agent.controller.js";
import User from "../models/Users.js";

// ---- Mock asyncHandler to pass-through ----
jest.mock("../utils/asyncHandler.js", () => ({
  asyncHandler: (fn) => fn,
}));

// ---- Mock User Model ----
jest.mock("../models/Users.js");

// ---- Helper for res ----
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Agent Controller - getAllAgents", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return agents successfully", async () => {
    const req = {};
    const res = mockRes();

    const mockAgents = [
      {
        _id: "1",
        username: "Agent One",
        serviceType: "Agent",
        createdAt: new Date(),
      },
      {
        _id: "2",
        username: "Agent Two",
        serviceType: "Agent",
        createdAt: new Date(),
      },
    ];

    // Mock chained mongoose calls
    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue(mockAgents),
    };

    User.find.mockReturnValue(mockQuery);

    await getAllAgents(req, res);

    expect(User.find).toHaveBeenCalledWith({ serviceType: "Agent" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        data: mockAgents,
        message: "Agents fetched successfully",
      })
    );
  });

  it("should return 404 if no agents found", async () => {
    const req = {};
    const res = mockRes();

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    };

    User.find.mockReturnValue(mockQuery);

    await getAllAgents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        data: [],
        message: "No agents found",
      })
    );
  });

  it("should handle server error", async () => {
    const req = {};
    const res = mockRes();

    User.find.mockImplementation(() => {
      throw new Error("DB error");
    });

    await expect(getAllAgents(req, res)).rejects.toThrow("DB error");
  });
});
