import Review from "../../models/LeaderBoard/Review.js";
import CallLog from "../../models/Talk-to-friend/callLogModel.js";
import User from "../../models/Users.js";

export const userStatics = async (req, res) => {
    try {
        const userId = req.user._id ||req.user.id;
        console.log(userId)
        // Total reviews by the user
        const totalReviews = await Review.countDocuments({ user: userId });

        // Total ongoing calls (assuming ongoing calls have no endTime)
        const totalOngoingCalls = await CallLog.countDocuments({
            $and: [
                { $or: [{ caller: userId }, { receiver: userId }] },
                { endTime: { $exists: false } } // Calls without an endTime
            ]
        });

        // Total incoming calls for the user
        const totalIncomingCalls = await CallLog.countDocuments({ receiver: userId });

        // Total calls involving the user (both incoming and outgoing)
        const totalCalls = await CallLog.countDocuments({
            $or: [{ caller: userId }, { receiver: userId }]
        });

        return res.status(200).json({
            totalReviews,
            totalOngoingCalls,
            totalIncomingCalls,
            totalCalls
        });
    } catch (error) {
        console.error("Error fetching user statistics:", error);
        return res.status(500).json({ message: "Error fetching user statistics", error });
    }
};