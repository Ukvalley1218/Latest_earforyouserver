import { ChatCommission } from "../../models/Chat/ChatCommission.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * @description Create or update chat commission settings
 * @route POST /api/admin/chat-commission
 * @access Private/Admin
 */
export const upsertChatCommission = asyncHandler(async (req, res) => {
  const { commissionType, percentageAmount, fixedAmount, chatPrice } = req.body;

  // Validate commission type
  if (commissionType && !['percentage', 'fixed'].includes(commissionType)) {
    throw new ApiError(400, "Invalid commission type. Must be 'percentage' or 'fixed'");
  }

  // Validate percentage amount if type is percentage
  if (commissionType === 'percentage' && (percentageAmount < 0 || percentageAmount > 100)) {
    throw new ApiError(400, "Percentage amount must be between 0 and 100");
  }

  // Validate fixed amount if type is fixed
  if (commissionType === 'fixed' && fixedAmount < 0) {
    throw new ApiError(400, "Fixed amount cannot be negative");
  }

  // Validate chat price if type is percentage
  if (commissionType === 'percentage' && chatPrice < 0) {
    throw new ApiError(400, "Chat price cannot be negative");
  }

  // Deactivate all previous settings
  await ChatCommission.updateMany({}, { isActive: false });

  // Create new settings
  const newSettings = await ChatCommission.create({
    commissionType: commissionType || 'percentage',
    percentageAmount: percentageAmount ?? 100,
    fixedAmount: fixedAmount ?? 0,
    chatPrice: chatPrice ?? 0,
    admin: req.admin?._id || req.user?._id,
    isActive: true
  });

  return res.status(201).json(
    new ApiResponse(201, newSettings, "Chat commission settings saved successfully")
  );
});

/**
 * @description Get current active chat commission settings
 * @route GET /api/admin/chat-commission
 * @access Private/Admin
 */
export const getChatCommission = asyncHandler(async (req, res) => {
  const settings = await ChatCommission.getActiveSettings();

  if (!settings) {
    // Return default settings if none exist
    return res.status(200).json(
      new ApiResponse(200, {
        commissionType: 'percentage',
        percentageAmount: 100,
        fixedAmount: 0,
        chatPrice: 0,
        isActive: true
      }, "No settings found, returning defaults")
    );
  }

  return res.status(200).json(
    new ApiResponse(200, settings, "Chat commission settings retrieved successfully")
  );
});

/**
 * @description Update chat commission settings
 * @route PUT /api/admin/chat-commission/:id
 * @access Private/Admin
 */
export const updateChatCommission = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { commissionType, percentageAmount, fixedAmount, chatPrice, isActive } = req.body;

  const settings = await ChatCommission.findById(id);

  if (!settings) {
    throw new ApiError(404, "Chat commission settings not found");
  }

  // Update fields if provided
  if (commissionType) {
    if (!['percentage', 'fixed'].includes(commissionType)) {
      throw new ApiError(400, "Invalid commission type. Must be 'percentage' or 'fixed'");
    }
    settings.commissionType = commissionType;
  }

  if (percentageAmount !== undefined) {
    if (percentageAmount < 0 || percentageAmount > 100) {
      throw new ApiError(400, "Percentage amount must be between 0 and 100");
    }
    settings.percentageAmount = percentageAmount;
  }

  if (fixedAmount !== undefined) {
    if (fixedAmount < 0) {
      throw new ApiError(400, "Fixed amount cannot be negative");
    }
    settings.fixedAmount = fixedAmount;
  }

  if (chatPrice !== undefined) {
    if (chatPrice < 0) {
      throw new ApiError(400, "Chat price cannot be negative");
    }
    settings.chatPrice = chatPrice;
  }

  if (isActive !== undefined) {
    settings.isActive = isActive;
  }

  await settings.save();

  return res.status(200).json(
    new ApiResponse(200, settings, "Chat commission settings updated successfully")
  );
});

/**
 * @description Get all chat commission settings history
 * @route GET /api/admin/chat-commission/history
 * @access Private/Admin
 */
export const getChatCommissionHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  const settings = await ChatCommission.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await ChatCommission.countDocuments();

  return res.status(200).json(
    new ApiResponse(200, {
      settings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    }, "Chat commission history retrieved successfully")
  );
});