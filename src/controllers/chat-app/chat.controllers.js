import mongoose from "mongoose";
import { ChatEventEnum } from "../../../src/constants.js";
import User from "../../models/Users.js";
import { Chat } from "../../models/chat.modal.js";
import { ChatMessage } from "../../models/message.models.js";
import { emitSocketEvent } from "../../socket/index.js";
import { ApiError } from "../../../src/utils/ApiError.js";
import { ApiResponse } from "../../../src/utils/ApiResponse.js";
import { asyncHandler } from "../../../src/utils/asyncHandler.js";
import { removeLocalFile } from "../../../src/utils/helpers.js";



/**
 * @description Marks a message as read and updates the seen status
 * @route POST /api/v1/messages/:messageId/read
 */

const markMessageAsRead = asyncHandler(async (req, res) => {
  const { messageId } = req.params;

  // Find the message by ID
  const message = await ChatMessage.findById(messageId);

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  // Check if the user has already read the message
  if (message.seenBy && message.seenBy.includes(req.user._id)) {
    return res.status(200).json(new ApiResponse(200, {}, "Message already marked as read"));
  }

  // Update the message's seenBy and isRead fields with the current user's ID
  message.seenBy = [req.user._id]; // Ensure only one user is recorded
  message.isRead = true;  // Mark the message as read

  await message.save();

  // Emit a MESSAGE_READ_EVENT for real-time notification
  emitSocketEvent(
    req,
    message.chat.toString(), // Target chat room or specific identifier
    ChatEventEnum.MESSAGE_READ_EVENT, // Event type
    {
      messageId,
      seenBy: message.seenBy, // Only the user who marked it as read
    }
  );

  return res
    .status(200)
    .json(
      new ApiResponse(200, { messageId, seenBy: message.seenBy }, "Message marked as read successfully")
    );
});


/**
 * @description Utility function which returns the pipeline stages to structure the chat schema with common lookups
 * @returns {mongoose.PipelineStage[]}
 */

const chatCommonAggregation = () => {
  return [
    {
      // lookup for the participants present
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "participants",
        as: "participants",
        pipeline: [
          {
            $project: {
              password: 0,
              refreshToken: 0,
              forgotPasswordToken: 0,
              forgotPasswordExpiry: 0,
              emailVerificationToken: 0,
              emailVerificationExpiry: 0,
            },
          },
        ],
      },
    },
    {
      // lookup for the group chats
      $lookup: {
        from: "chatmessages",
        foreignField: "_id",
        localField: "lastMessage",
        as: "lastMessage",
        pipeline: [
          {
            // get details of the sender
            $lookup: {
              from: "users",
              foreignField: "_id",
              localField: "sender",
              as: "sender",
              pipeline: [
                {
                  $project: {
                    username: 1,
                    avatar: 1,
                    email: 1,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              sender: { $first: "$sender" },
            },
          },
        ],
      },
    },
    {
      $addFields: {
        lastMessage: { $first: "$lastMessage" },
      },
    },
  ];
};

/**
 *
 * @param {string} chatId
 * @description utility function responsible for removing all the messages and file attachments attached to the deleted chat
 */

const deleteCascadeChatMessages = async (chatId) => {
  // fetch the messages associated with the chat to remove
  const messages = await ChatMessage.find({
    chat: new mongoose.Types.ObjectId(chatId),
  });

  let attachments = [];

  // get the attachments present in the messages
  attachments = attachments.concat(
    ...messages.map((message) => {
      return message.attachments;
    })
  );

  attachments.forEach((attachment) => {
    // remove attachment files from the local storage
    removeLocalFile(attachment.localPath);
  });

  // delete all the messages
  await ChatMessage.deleteMany({
    chat: new mongoose.Types.ObjectId(chatId),
  });
};



const searchAvailableUsers = asyncHandler(async (req, res) => {
  const users = await User.aggregate([
    {
      $match: {
        _id: {
          $ne: req.user._id, // avoid logged in user
        },
      },
    },
    {
      $project: {
        avatar: 1,
        username: 1,
        email: 1,
      },
    },
  ]);

  return res
    .status(200)
    .json(new ApiResponse(200, users, "Users fetched successfully"));
});

const createOrGetAOneOnOneChat = asyncHandler(async (req, res) => {
  const { receiverId } = req.params;

  // Check if it's a valid receiver
  const receiver = await User.findById(receiverId);

  if (!receiver) {
    throw new ApiError(404, "Receiver does not exist");
  }
  console.log(req.user._id);
  // check if receiver is not the user who is requesting a chat
  if (receiver._id.toString() === req.user._id.toString()) {
    throw new ApiError(400, "You cannot chat with yourself");
  }
  // Check if a chat already exists between these two participants
  const existingChat = await Chat.findOne({
    participants: { $all: [req.user._id, receiverId] },
  });

  if (existingChat) {
    // If chat exists, return the existing chat
    return res.status(200).json({ data: existingChat });
  }
  const chat = await Chat.aggregate([
    {
      $match: {
        isGroupChat: false, // This controller is responsible for one on one chats
        // Also, filter chats with participants having receiver and logged in user only
        $and: [
          {
            participants: { $elemMatch: { $eq: req.user._id } },
          },
          {
            participants: {
              $elemMatch: { $eq: new mongoose.Types.ObjectId(receiverId) },
            },
          },
        ],
      },
    },
    ...chatCommonAggregation(),
  ]);

  if (chat.length) {
    // if we find the chat that means user already has created a chat
    return res
      .status(200)
      .json(new ApiResponse(200, chat[0], "Chat retrieved successfully"));
  }

  // if not we need to create a new one on one chat
  const newChatInstance = await Chat.create({
    name: "One on one chat",
    participants: [req.user._id, new mongoose.Types.ObjectId(receiverId)], // add receiver and logged in user as participants
    admin: req.user._id,
  });

  // structure the chat as per the common aggregation to keep the consistency
  const createdChat = await Chat.aggregate([
    {
      $match: {
        _id: newChatInstance._id,
      },
    },
    ...chatCommonAggregation(),
  ]);

  const payload = createdChat[0]; // store the aggregation result

  if (!payload) {
    throw new ApiError(500, "Internal server error");
  }

  // logic to emit socket event about the new chat added to the participants
  payload?.participants?.forEach((participant) => {
    if (participant._id.toString() === req.user._id.toString()) return; // don't emit the event for the logged in use as he is the one who is initiating the chat

    // emit event to other participants with new chat as a payload
    emitSocketEvent(
      req,
      participant._id?.toString(),
      ChatEventEnum.NEW_CHAT_EVENT,
      payload
    );
  });

  return res
    .status(201)
    .json(new ApiResponse(201, payload, "Chat retrieved successfully"));
});




const deleteOneOnOneChat = asyncHandler(async (req, res) => {
  const { chatId } = req.params;

  // check for chat existence
  const chat = await Chat.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(chatId),
      },
    },
    ...chatCommonAggregation(),
  ]);

  const payload = chat[0];

  if (!payload) {
    throw new ApiError(404, "Chat does not exist");
  }

  await Chat.findByIdAndDelete(chatId); // delete the chat even if user is not admin because it's a personal chat

  await deleteCascadeChatMessages(chatId); // delete all the messages and attachments associated with the chat

  const otherParticipant = payload?.participants?.find(
    (participant) => participant?._id.toString() !== req.user._id.toString() // get the other participant in chat for socket
  );

  // emit event to other participant with left chat as a payload
  emitSocketEvent(
    req,
    otherParticipant._id?.toString(),
    ChatEventEnum.LEAVE_CHAT_EVENT,
    payload
  );

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Chat deleted successfully"));
});



// const getAllChats = asyncHandler(async (req, res) => {
//   const chats = await Chat.aggregate([
//     {
//       $match: {
//         participants: { $elemMatch: { $eq: req.user._id } }, // get all chats that have logged in user as a participant
//       },
//     },
//     {
//       $sort: {
//         updatedAt: -1,
//       },
//     },
//     ...chatCommonAggregation(),
//   ]);

//   return res
//     .status(200)
//     .json(
//       new ApiResponse(200, chats || [], "User chats fetched successfully!")
//     );
// });


const getAllChats = asyncHandler(async (req, res) => {
  const chats = await Chat.aggregate([
    {
      $match: {
        participants: { $elemMatch: { $eq: req.user._id } }, // Match chats with the logged-in user as a participant
      },
    },
    {
      $lookup: {
        from: "messages", // Assuming messages are stored in a separate collection
        localField: "_id", // Chat ID
        foreignField: "chatId", // Corresponding chat ID in the messages collection
        as: "messages",
        pipeline: [
          { $sort: { createdAt: -1 } }, // Sort messages by creation time in descending order
          { $limit: 1 }, // Fetch only the most recent message
        ],
      },
    },
    {
      $addFields: {
        lastMessage: { $arrayElemAt: ["$messages", 0] }, // Extract the most recent message
      },
    },
    {
      $project: {
        messages: 0, // Exclude the `messages` field as it's no longer needed
      },
    },
    {
      $sort: {
        updatedAt: -1, // Sort chats by update time
      },
    },
    ...chatCommonAggregation(), // Include your common aggregation steps if necessary
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(200, chats || [], "User chats fetched successfully!")
    );
});










export {
  createOrGetAOneOnOneChat,
  deleteOneOnOneChat,
  searchAvailableUsers,
  markMessageAsRead,
  getAllChats, 
};
