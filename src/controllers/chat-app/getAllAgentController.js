import { asyncHandler } from "../../../src/utils/asyncHandler.js";
import User from "../../models/Users.js";
import { ApiResponse } from "../../utils/ApiResponse.js";

const getAllAgents = asyncHandler(async (req, res) => {
  const agents = await User.find({ serviceType: "Agent" })
    .select("-password -refreshTokens -otp -otpExpires")
    .sort({ createdAt: -1 });
  if (!agents.length) {
    return res.status(404).json(new ApiResponse(404, [], "No agents found"));
  }
  let lng = agents.length;
  return res
    .status(200)
    .json(new ApiResponse(200, agents, lng, "Agents fetched successfully"));
});

const getAgentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const agent = await User.findOne({ _id: id, serviceType: "Agent" }).select(
    "-password -refreshTokens -otp -otpExpires"
  );

  if (!agent) {
    return res.status(404).json(new ApiResponse(404, null, "Agent not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, agent, "Agent fetched successfully"));
});
const createAgent = asyncHandler(async (req, res) => {
  const { name, email, phone } = req.body;

  const existingAgent = await User.findOne({ email });
  if (existingAgent) {
    return res
      .status(409)
      .json(new ApiResponse(409, null, "Agent already exists"));
  }

  const agent = await User.create({
    ...req.body,
    serviceType: "Agent",
  });

  return res
    .status(201)
    .json(new ApiResponse(201, agent, "Agent created successfully"));
});
export { getAllAgents, createAgent, getAgentById };
