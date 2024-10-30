import { asyncHandler } from "../../../src/utils/asyncHandler.js";
import User from "../../models/Users.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
const getAllAgents = asyncHandler(async (req, res) => {
  const agents = await User.find({
    serviceType: 'Agent'
  }).select('-password -refreshTokens -otp -otpExpires').sort({
    createdAt: -1
  });
  if (!agents.length) {
    return res.status(404).json(new ApiResponse(404, [], "No agents found"));
  }
  let lng = agents.length;
  return res.status(200).json(new ApiResponse(200, agents, lng, "Agents fetched successfully"));
});
export { getAllAgents };