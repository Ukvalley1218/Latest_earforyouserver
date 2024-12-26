import EarningWallet from "../../models/Wallet/EarningWallet.js";
import WithdrawalRequest from "../../models/Wallet/WithWrdal.js";

export const requestWithdrawal = async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const { amount } = req.body;

        // Fetch user earnings
        const wallet = await EarningWallet.findOne({ userId });
        if (!wallet) {
            return res.status(404).json({ error: 'Earning wallet not found.' });
        }

        // Check if the user has sufficient balance
        if (wallet.balance < amount) {
            return res.status(400).json({ error: 'Insufficient balance.' });
        }

        // Create a withdrawal request
        const withdrawalRequest = new WithdrawalRequest({
            userId,
            amount,
        });

        await withdrawalRequest.save();

        // Optionally, notify admin (e.g., via email or dashboard update)

        return res.status(200).json({
            message: 'Withdrawal request submitted successfully.',
            request: withdrawalRequest,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};



export const getWithdrawal = async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;

        // Pagination parameters
        const page = parseInt(req.query.page, 10) || 1; // Default page is 1
        const limit = parseInt(req.query.limit, 10) || 20; // Default limit is 20

        // Validate pagination parameters
        if (page <= 0 || limit <= 0) {
            return res.status(400).json({ error: 'Invalid page or limit value. Page and limit must be positive integers.' });
        }

        // Fetch withdrawal requests with pagination
        const totalTransactions = await WithdrawalRequest.countDocuments({ userId });
        const totalPages = Math.ceil(totalTransactions / limit);

        if (totalTransactions === 0) {
            return res.status(404).json({ message: 'No withdrawal transactions found.' });
        }

        const withdrawals = await WithdrawalRequest.find({ userId })
            .sort({ requestedAt: -1 }) // Sort by most recent first
            .skip((page - 1) * limit)
            .limit(limit);

        return res.status(200).json({
            message: 'Withdrawal transactions retrieved successfully.',
            withdrawals,
            currentPage: page,
            totalPages,
            totalTransactions,
        });
    } catch (error) {
        console.error('Error fetching withdrawal transactions:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};




