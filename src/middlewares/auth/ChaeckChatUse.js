import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiError } from "../../utils/ApiError.js";
import { ChatUserPremium } from "../../models/Subscriptionchat/ChatUserPremium.js";
import mongoose from "mongoose";
import User from "../../models/Users.js";
import { Chat } from "../../models/chat.modal.js";

const countBillableCharacters = (text = "") =>
  text.replace(/\s+/g, "").length;


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

    // Skip premium checks for non-regular users
    if (user.userCategory !== "User" || user.userType === "RECEIVER") {
        return next();
    }

    // Parallel lookups for better performance
    const [existingChatUsage, activePlan, hasCompletedPlans, hasNonCompletedPlans] = await Promise.all([
        // Check if chat was already used in a valid plan
        ChatUserPremium.findOne({
            user: userId,
            "payment.status": { $in: ["COMPLETED", "success"] },
            // "usedChats.chatId": otherParticipantId
        }).populate('plan').lean(),

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

    // Case 1: Chat was previously accessed with a valid plan
    // if (existingChatUsage) {
    //     req.activePlan = {
    //         _id: existingChatUsage._id,
    //         remainingChats: existingChatUsage.remainingChats,
    //         expiryDate: existingChatUsage.expiryDate,
    //         plan: existingChatUsage.plan,
    //         previouslyUsed: true,
    //         lastUsedAt: existingChatUsage.usedChats.find(chat => chat.chatId.equals(otherParticipantId))?.usedAt || new Date()
    //     };
    //     return next();
    // }

    // Case 2: Active plan available
    if (activePlan) {
        // Prepare update operations
        const updateOps = {
            // $inc: { remainingChats: -1 },
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

    // Case 3: No active plan available
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

        if (user.userType === "RECEIVER") {
            return res.status(200).json({
                success: true,
                message: "Chat access granted for non-regular user",
                data: {
                    bypass: true,
                    userCategory: user.userCategory
                }
            });
        }

        // Skip premium checks for non-regular users (e.g., admins)
        if (user.userCategory !== "User") {
            return res.status(200).json({
                success: true,
                message: "Chat access granted for non-regular user",
                data: {
                    bypass: true,
                    userCategory: user.userCategory
                }
            });
        }

        

        const chatObjectId = new mongoose.Types.ObjectId(chatId);

        // Parallel lookups for better performance
        const [existingChatUsage, activePlan, hasCompletedPlans, hasNonCompletedPlans] = await Promise.all([
            ChatUserPremium.findOne({
                user: userId,
                "payment.status": { $in: ["COMPLETED", "success"] },
                // "usedChats.chatId": chatObjectId
            }).populate('plan').lean(),

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

        // Case 1: Chat was previously accessed with a valid plan
        // if (existingChatUsage) {
        //     const usedChat = existingChatUsage.usedChats.find(chat => chat.chatId.equals(chatObjectId));
            
        //     return res.status(200).json({
        //         success: true,
        //         message: "Chat previously accessed with a valid plan",
        //         data: {
        //             activePlan: {
        //                 _id: existingChatUsage._id,
        //                 remainingChats: existingChatUsage.remainingChats,
        //                 expiryDate: existingChatUsage.expiryDate,
        //                 plan: existingChatUsage.plan,
        //                 previouslyUsed: true,
        //                 lastUsedAt: usedChat?.usedAt || null
        //             }
        //         }
        //     });
        // }

        // Case 2: Active plan available
        if (activePlan) {
            // Prepare update operations
            const updateOps = {
                // $inc: { remainingChats: -1 },
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

        // Case 3: No active plan available
        let errorCode = "NO_ACTIVE_PLAN";
        let errorMessage = "No active chat packs available.";
        const metadata = { 
            suggestPurchase: true,
            availablePlans: [] // You might want to populate this with available plans
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
        console.error("Error in checkChatAccess:", error);
        return res.status(500).json(
            new ApiError(500, "Internal server error while checking chat access", {
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        );
    }
};


export const checkAndCutCharacters = async (req, res) => {
  try {
    const userId = req.user._id;
    const { chatId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      throw new ApiError(400, "Message cannot be empty");
    }

    const charactersUsed = countBillableCharacters(content);

    const subscription = await ChatUserPremium.findOne({
      user: userId,
      isActive: true,
      expiryDate: { $gt: new Date() },
      "payment.status": { $in: ["COMPLETED", "success"] }
    }).sort({ purchaseDate: -1 });

    if (!subscription) {
      throw new ApiError(403, "No active subscription");
    }

    if (subscription.remainingCharacters < charactersUsed) {
      throw new ApiError(402, "Insufficient characters", {
        required: charactersUsed,
        available: subscription.remainingCharacters
      });
    }

    // ✅ Deduct characters
    subscription.remainingCharacters -= charactersUsed;

    subscription.usageLogs.push({
      chatId,
      charactersUsed,
      usedAt: new Date()
    });

    if (subscription.remainingCharacters <= 0) {
      subscription.isActive = false;
    }

    await subscription.save();

    return res.status(200).json({
      success: true,
      charactersUsed,
      remainingCharacters: subscription.remainingCharacters
    });

  } catch (error) {
    return res.status(error.statusCode || 500).json(error);
  }
};



// export const checkandcut = async (req, res) => {
//     try {
//         const { receiverId: chatId } = req.params;
//         const userId = req.user._id;

//         if (!mongoose.Types.ObjectId.isValid(chatId)) {
//             return res.status(400).json(new ApiError(400, "Invalid chat ID format"));
//         }

//         const chatObjectId = new mongoose.Types.ObjectId(chatId);

//         // Parallel lookups for better performance
//         const [existingChatUsage, activePlan, hasCompletedPlans, hasNonCompletedPlans] = await Promise.all([
//             // Check if chat was already used in a COMPLETED or SUCCESS plan
//             ChatUserPremium.findOne({
//                 user: userId,
//                 "payment.status": { $in: ["COMPLETED", "success"] },
//                 "usedChats.chatId": chatObjectId
//             }).populate('plan').lean(),

//             // Find the most recent active, COMPLETED or SUCCESS plan with remaining chats
//             ChatUserPremium.findOne({
//                 user: userId,
//                 isActive: true,
//                 "payment.status": { $in: ["COMPLETED", "success"] },
//                 expiryDate: { $gt: new Date() },
//                 remainingChats: { $gt: 0 }
//             }).sort({ purchaseDate: -1 }).populate('plan'),

//             // Check if user has any COMPLETED or SUCCESS plans
//             ChatUserPremium.exists({
//                 user: userId,
//                 "payment.status": { $in: ["COMPLETED", "success"] }
//             }),

//             // Check if user has any non-COMPLETED and non-SUCCESS plans
//             ChatUserPremium.exists({
//                 user: userId,
//                 "payment.status": { $nin: ["COMPLETED", "success"] }
//             })
//         ]);

//         // Case 1: Chat was previously accessed with a valid plan
//         if (existingChatUsage) {
//             return res.status(200).json({
//                 success: true,
//                 activePlan: {
//                     _id: existingChatUsage._id,
//                     remainingChats: existingChatUsage.remainingChats,
//                     expiryDate: existingChatUsage.expiryDate,
//                     plan: existingChatUsage.plan,
//                     previouslyUsed: true,
//                     lastUsedAt: existingChatUsage.usedChats.find(chat => chat.chatId.equals(chatObjectId)).usedAt
//                 }
//             });
//         }

//         // Case 2: Active plan available
//         if (activePlan) {
//             // Prepare update operations
//             const updateOps = {
//                 $inc: { remainingChats: -1 },
//                 $push: { usedChats: { chatId: chatObjectId, usedAt: new Date() } }
//             };

//             // Auto-deactivate if no chats will be left after this operation
//             if (activePlan.remainingChats <= 1) {
//                 updateOps.$set = { isActive: false };
//             }

//             // Fire-and-forget the update (no need to await for response)
//             ChatUserPremium.updateOne({ _id: activePlan._id }, updateOps)
//                 .catch(err => console.error('Error updating chat plan:', err));

//             return res.status(200).json({
//                 success: true,
//                 activePlan: {
//                     _id: activePlan._id,
//                     remainingChats: activePlan.remainingChats - 1,
//                     expiryDate: activePlan.expiryDate,
//                     plan: activePlan.plan,
//                     lastUsedAt: new Date()
//                 }
//             });
//         }

//         // Case 3: No active plan available
//         let errorMessage = "No active chat packs available.";
//         const metadata = { suggestPurchase: true };

//         if (hasCompletedPlans) {
//             errorMessage = "Your chat packs have expired or been fully used. Please purchase a new pack.";
//             metadata.hasPreviousPlans = true;
//         } else if (hasNonCompletedPlans) {
//             errorMessage = "You have pending payments. Please complete your payment to access chats.";
//             metadata.hasPendingPayments = true;
//         }
        

//         return res.status(403).json(
//             new ApiError(403, errorMessage, null, metadata)
//         );

//     } catch (error) {
//         console.error("Error in checkChatAccess:", error);
//         return res.status(500).json(
//             new ApiError(500, "Internal server error while checking chat access")
//         );
//     }
// };