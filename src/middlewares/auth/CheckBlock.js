import User from "../../models/Users.js";

export const checkUserStatus = async (req, res, next) => {
    try {
        // Extract the userId from the request object (assumes user is authenticated)
        const userId = req.user._id; // Get user ID from the request (assuming it's set in middleware)
        // If userId is missing, respond with an unauthorized error
        console.log("checkUserStatus",userId)
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized: User ID is missing." });
        }

        // Find the user in the database by ID
        const user = await User.findById(userId);

        // If no user is found, respond with a not found error
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        // Check the user's status; deny access if the user is blocked
        if (user.UserStatus === "Blocked") {
            return res.status(403).json({ message: "Access denied: Your account is blocked." });
        }

        // User is authorized; proceed to the next middleware or route handler
        next();
    } catch (error) {
        console.error("Error in checkUserStatus middleware:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};
