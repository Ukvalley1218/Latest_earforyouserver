import Review from "../../models/LeaderBoard/Review.js";
import CallLog from "../../models/Talk-to-friend/callLogModel.js";
import User from "../../models/Users.js";

// export const userStatics = async (req, res) => {
//     try {
//         const userId = req.user._id || req.user.id;
//         console.log("userId", userId);
//         // Total reviews by the user
//         const totalReviews = await Review.countDocuments({ user: userId });
//         console.log("totalReviews", totalReviews)
//         // Total ongoing calls (assuming ongoing calls have no endTime)
//         const totalOutgoingCalls = await CallLog.countDocuments({
//             caller: userId, // Only match calls initiated by the user
          
//         });


//         // Total incoming calls for the user
//         const totalIncomingCalls = await CallLog.countDocuments({ receiver: userId });
//         console.log("totalIncomingCalls", totalIncomingCalls)
//         // Total calls involving the user (both incoming and outgoing)
//         const totalCalls = await CallLog.countDocuments({
//             $or: [{ caller: userId }, { receiver: userId }]
//         });

//         return res.status(200).json({
//             totalReviews,
//             totalOutgoingCalls,
//             totalIncomingCalls,
//             totalCalls
//         });
//     } catch (error) {
//         console.error("Error fetching user statistics:", error);
//         return res.status(500).json({ message: "Error fetching user statistics", error });
//     }
// };


export const userStatics = async (req, res) => {
    try {
        const userId = req.user?._id || req.user?.id;
        
        if (!userId) {
            return res.status(400).json({ 
                message: "User ID not found in request" 
            });
        }

        // Use Promise.all to execute queries concurrently
        const [totalReviews, callStats] = await Promise.all([
            Review.countDocuments({ user: userId }),
            CallLog.aggregate([
                {
                    $match: {
                        $or: [{ caller: userId }, { receiver: userId }]
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalOutgoing: {
                            $sum: {
                                $cond: [{ $eq: ["$caller", userId] }, 1, 0]
                            }
                        },
                        totalIncoming: {
                            $sum: {
                                $cond: [{ $eq: ["$receiver", userId] }, 1, 0]
                            }
                        },
                        totalCalls: { $sum: 1 }
                    }
                }
            ])
        ]);

        // Extract call statistics or default to 0 if no calls found
        const stats = callStats[0] || {
            totalOutgoing: 0,
            totalIncoming: 0,
            totalCalls: 0
        };

        return res.status(200).json({
            totalReviews,
            totalOutgoingCalls: stats.totalOutgoing,
            totalIncomingCalls: stats.totalIncoming,
            totalCalls: stats.totalCalls
        });

    } catch (error) {
        console.error("Error fetching user statistics:", error);
        
        // Send a more specific error message based on the error type
        const errorMessage = error.name === 'ValidationError' 
            ? 'Invalid data format'
            : 'Error fetching user statistics';
            
        return res.status(500).json({ 
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};