import mongoose from "mongoose";

const chatPremiumSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        price: {
            type: Number,
            required: true,
            min: 0
        },
        chatsAllowed: {
            type: Number,
            required: true,
            min: 1
        },
//         charactersAllowed: {
//   type: Number,
//   required: true
// },
        validityDays: {
            type: Number,
            required: true,
            min: 1
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model("ChatPremium", chatPremiumSchema);
