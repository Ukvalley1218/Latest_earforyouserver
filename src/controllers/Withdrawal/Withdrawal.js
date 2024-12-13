import EarningWallet from "../../models/Wallet/EarningWallet";
import WithdrawalRequest from "../../models/Wallet/WithWrdal";

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
