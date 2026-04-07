import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiError } from "../../utils/ApiError.js";
import { ChatUserPremium } from "../../models/Subscriptionchat/ChatUserPremium.js";
import mongoose from "mongoose";
import User from "../../models/Users.js";
import { Chat } from "../../models/chat.modal.js";


export const checkChatAccess = asyncHandler(async (req, res, next) => {
    const { chatId } = req.params;
    const userId = req.user._id;

    // Validate input IDs
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        throw new ApiError(400, "Invalid chat ID format");
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new ApiError(400, "Invalid user ID format");
    }

    // Find the chat and select only the participants field
    const chat = await Chat.findById(chatId).select('participants');
    if (!chat) {
        throw new ApiError(404, "Chat not found");
    }

    // Get the other participant ID (assuming 1:1 chat)
    const [otherParticipantId] = chat.participants.filter(
        participantId => !participantId.equals(userId)
    );

    if (!otherParticipantId) {
        throw new ApiError(400, "Invalid chat participants configuration");
    }

    // Check user existence and type
    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(404, "User not found", {
            field: "userId",
            value: userId,
            reason: "User does not exist"
        });
    }

    // Skip premium checks for non-"User" categories - free chats for others
    // Only users with userCategory === "User" need premium subscription
    if (user.userCategory !== "User") {
        return next();
    }

    // Parallel lookups for better performance
    const [activePlan, hasCompletedPlans, hasNonCompletedPlans] = await Promise.all([
        // Find the most recent active valid plan with remaining chats
        ChatUserPremium.findOne({
            user: userId,
            isActive: true,
            "payment.status": { $in: ["COMPLETED", "success"] },
            expiryDate: { $gt: new Date() },
            remainingChats: { $gt: 0 }
        }).sort({ purchaseDate: -1 }).populate('plan'),

        // Check if user has any completed plans
        ChatUserPremium.exists({
            user: userId,
            "payment.status": { $in: ["COMPLETED", "success"] }
        }),

        // Check if user has any pending payments
        ChatUserPremium.exists({
            user: userId,
            "payment.status": { $nin: ["COMPLETED", "success"] }
        })
    ]);

    // Active plan available - deduct chat
    if (activePlan) {
        // Prepare update operations
        const updateOps = {
            $push: { usedChats: { chatId: otherParticipantId, usedAt: new Date() } }
        };

        // Auto-deactivate if no chats will be left after this operation
        if (activePlan.remainingChats <= 1) {
            updateOps.$set = { isActive: false };
        }

        // Fire-and-forget the update
        ChatUserPremium.updateOne({ _id: activePlan._id }, updateOps)
            .catch(err => console.error('Error updating chat plan:', err));

        req.activePlan = {
            _id: activePlan._id,
            remainingChats: activePlan.remainingChats - 1,
            expiryDate: activePlan.expiryDate,
            plan: activePlan.plan,
            lastUsedAt: new Date()
        };
        return next();
    }

    // No active plan available
    const metadata = { suggestPurchase: true };
    let errorMessage = "No active chat packs available.";

    if (hasCompletedPlans) {
        errorMessage = "Your chat packs have expired or been fully used. Please purchase a new pack.";
        metadata.hasPreviousPlans = true;
    } else if (hasNonCompletedPlans) {
        errorMessage = "You have pending payments. Please complete your payment to access chats.";
        metadata.hasPendingPayments = true;
    }

    throw new ApiError(403, errorMessage, null, metadata);
});


export const checkandcut = async (req, res) => {
    try {
        const { receiverId: chatId } = req.params;
        const userId = req.user._id;

        // Validate chat ID format
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json(
                new ApiError(400, "Invalid chat ID format", {
                    field: "chatId",
                    value: chatId,
                    reason: "Must be a valid MongoDB ObjectId"
                })
            );
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new ApiError(404, "User not found", {
                field: "userId",
                value: userId,
                reason: "User does not exist"
            });
        }

        // Skip premium checks for non-"User" categories - free chats for others
        if (user.userCategory !== "User") {
            return res.status(200).json({
                success: true,
                message: "Chat access granted - free for non-User category",
                data: {
                    bypass: true,
                    userCategory: user.userCategory,
                    freeChats: true
                }
            });
        }

        const chatObjectId = new mongoose.Types.ObjectId(chatId);

        // Parallel lookups for better performance
        const [activePlan, hasCompletedPlans, hasNonCompletedPlans] = await Promise.all([
            ChatUserPremium.findOne({
                user: userId,
                isActive: true,
                "payment.status": { $in: ["COMPLETED", "success"] },
                expiryDate: { $gt: new Date() },
                remainingChats: { $gt: 0 }
            }).sort({ purchaseDate: -1 }).populate('plan'),

            ChatUserPremium.exists({
                user: userId,
                "payment.status": { $in: ["COMPLETED", "success"] }
            }),

            ChatUserPremium.exists({
                user: userId,
                "payment.status": { $nin: ["COMPLETED", "success"] }
            })
        ]);

        // Active plan available - deduct chat
        if (activePlan) {
            // Prepare update operations
            const updateOps = {
                $push: { usedChats: { chatId: chatObjectId, usedAt: new Date() } }
            };

            // Auto-deactivate if no chats will be left after this operation
            if (activePlan.remainingChats <= 1) {
                updateOps.$set = { isActive: false };
            }

            // Fire-and-forget the update (no need to await for response)
            ChatUserPremium.updateOne({ _id: activePlan._id }, updateOps)
                .catch(err => console.error('Error updating chat plan:', err));

            return res.status(200).json({
                success: true,
                message: "Chat access granted with active plan",
                data: {
                    activePlan: {
                        _id: activePlan._id,
                        remainingChats: activePlan.remainingChats - 1,
                        expiryDate: activePlan.expiryDate,
                        plan: activePlan.plan,
                        lastUsedAt: new Date()
                    }
                }
            });
        }

        // No active plan available
        let errorCode = "NO_ACTIVE_PLAN";
        let errorMessage = "No active chat packs available.";
        const metadata = {
            suggestPurchase: true,
            availablePlans: []
        };

        if (hasCompletedPlans) {
            errorCode = "PLANS_EXHAUSTED";
            errorMessage = "Your chat packs have expired or been fully used. Please purchase a new pack.";
            metadata.hasPreviousPlans = true;
        } else if (hasNonCompletedPlans) {
            errorCode = "PENDING_PAYMENTS";
            errorMessage = "You have pending payments. Please complete your payment to access chats.";
            metadata.hasPendingPayments = true;
        }

        return res.status(403).json(
            new ApiError(403, errorMessage, {
                code: errorCode,
                ...metadata
            })
        );

    } catch (error) {
        console.error("Error in checkandcut:", error);
        return res.status(500).json(
            new ApiError(500, "Internal server error while checking chat access", {
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        );
    }
};