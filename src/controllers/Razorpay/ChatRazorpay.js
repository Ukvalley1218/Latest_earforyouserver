import { ChatUserPremium } from '../../models/Subscriptionchat/ChatUserPremium.js';
import ChatPremium from '../../models/Subscriptionchat/ChatPremium.js';
import { CouponUsage, Coupon } from '../../models/CouponSystem/couponModel.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import User from '../../models/Users.js';
import admin from '../../config/firebaseConfig.js';

// Initialize Razorpay instance with error handling
let instance;
try {
    instance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
} catch (error) {
    console.error('Razorpay initialization failed:', error);
    throw new Error('Payment gateway initialization failed');
}

export const paymentService = {
    /**
     * Creates a Razorpay order for subscription purchase
     * @param {string} userId - User ID
     * @param {string} planId - Plan ID
     * @param {string} [couponCode] - Optional coupon code
     * @returns {Promise<Object>} Order details
     */
    async createOrder(userId, planId, couponCode = null) {
        try {
            if (!userId || !planId) {
                throw new ApiError(400, 'User ID and Plan ID are required');
            }

            const plan = await ChatPremium.findById(planId);
            if (!plan) throw new ApiError(404, 'Invalid or inactive plan');
            if (plan.price <= 0) throw new ApiError(400, 'Invalid plan price');

            // Process coupon if provided
            let finalAmount = plan.price;
            let couponDetails = null;
            let discountAmount = 0;
            let extendedDays = 0;

            if (couponCode) {
                const couponResult = await this.processCoupon(couponCode, userId, plan.price, plan);
                if (couponResult) {
                    finalAmount = couponResult.finalAmount;
                    discountAmount = couponResult.discountAmount;
                    extendedDays = couponResult.extendedDays;
                    couponDetails = couponResult.coupon;
                }
            }

            // Generate a shorter receipt ID (max 40 chars)
            const receiptId = `sub_${userId.toString().slice(-12)}_${Date.now().toString().slice(-6)}`;

            const order = await instance.orders.create({
                amount: Math.round(finalAmount * 100), // Convert to paise
                currency: 'INR',
                receipt: receiptId,
                notes: {
                    userId: userId.toString(),
                    planId: planId.toString(),
                    couponCode: couponCode || '',
                    originalAmount: plan.price,
                    discountAmount,
                    extendedDays,
                },
            });

            if (!order || !order.id) {
                throw new ApiError(500, 'Failed to create order with Razorpay');
            }

            return {
                id: order.id,
                amount: order.amount / 100, // Convert back to rupees
                currency: order.currency,
                key: process.env.RAZORPAY_KEY_ID,
                plan: {
                    name: plan.name,
                    chats: plan.chatsAllowed,
                    validity: plan.validityDays,
                },
                couponApplied: couponDetails ? couponDetails.code : null,
                discountAmount,
                extendedDays,
            };
        } catch (error) {
            console.error('Error in createOrder:', error);
            throw error instanceof ApiError ? error : new ApiError(500, `Order creation failed: ${error.message}`);
        }
    },

    /**
     * Verifies payment and activates subscription
     * @param {string} userId - User ID
     * @param {string} planId - Plan ID
     * @param {Object} paymentData - Payment data from Razorpay
     * @param {string} [couponCode] - Optional coupon code
     * @returns {Promise<Object>} Subscription details
     */
    async verifyAndActivate(userId, planId, paymentData, couponCode = null) {
        try {
            if (
                !paymentData ||
                !paymentData.razorpay_order_id ||
                !paymentData.razorpay_payment_id ||
                !paymentData.razorpay_signature
            ) {
                throw new ApiError(400, 'Invalid payment data provided');
            }

            this.validatePayment(paymentData);

            const plan = await ChatPremium.findById(planId);
            if (!plan) throw new ApiError(404, 'Plan not found');

            // Get order details to retrieve coupon information
            const order = await instance.orders.fetch(paymentData.razorpay_order_id);
            const { originalAmount = plan.price, discountAmount = 0, extendedDays = 0 } = order.notes || {};

            let paymentDetails;
            try {
                paymentDetails = await this.processPayment(paymentData, originalAmount - discountAmount);
            } catch (error) {
                if (error.message.includes('This payment has already been captured')) {
                    const payment = await instance.payments.fetch(paymentData.razorpay_payment_id);
                    if (payment.status === 'captured') {
                        paymentDetails = {
                            status: 'success',
                            transactionId: paymentData.razorpay_order_id,
                            paymentId: paymentData.razorpay_payment_id,
                            signature: paymentData.razorpay_signature,
                            amount: originalAmount - discountAmount,
                            originalAmount,
                            discountAmount,
                            gatewayResponse: payment,
                            completedAt: new Date(),
                        };
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }

            // Add coupon details to payment record if applicable
            if (couponCode) {
                paymentDetails.couponCode = couponCode;
                paymentDetails.discountAmount = discountAmount;
                paymentDetails.extendedDays = extendedDays;
            }

            return await this.createSubscription(userId, planId, paymentDetails);
        } catch (error) {
            console.error('Error in verifyAndActivate:', error);
            throw error instanceof ApiError
                ? error
                : new ApiError(500, `Payment verification failed: ${error.message || 'Unknown error'}`);
        }
    },

    /**
     * Handles Razorpay webhook events
     * @param {Object} req - Express request object
     * @returns {Promise<void>}
     */
    async handleWebhook(req) {
        try {
            const { event, payload } = req.body;
            if (!event || !payload) {
                throw new ApiError(400, 'Invalid webhook payload');
            }

            const handlers = {
                'payment.captured': this.handlePaymentSuccess,
                'payment.failed': this.handlePaymentFailure,
                'subscription.charged': this.handlePaymentSuccess,
                'order.paid': this.handlePaymentSuccess,
            };

            if (handlers[event]) {
                await handlers[event].call(this, payload.payment?.entity || payload.subscription?.entity);
            } else {
                console.log(`Unhandled webhook event: ${event}`);
            }
        } catch (error) {
            console.error('Webhook processing error:', error);
            throw error instanceof ApiError ? error : new ApiError(500, `Webhook processing failed: ${error.message}`);
        }
    },

    // ===== PRIVATE METHODS ===== //

    /**
     * Processes coupon code and calculates discounts
     * @param {string} couponCode - Coupon code
     * @param {string} userId - User ID
     * @param {number} amount - Original amount
     * @returns { Craft a concise and accurate docstring for this method
     * @returns {Promise<Object|null>} Coupon processing result or null if invalid
     */
    async processCoupon(couponCode, userId, amount, planId) {
        try {

            const plan = await ChatPremium.findById(planId); // ✅ Fetch plan inside
            if (!plan) throw new ApiError(404, 'Plan not found');


            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
            if (!coupon) return null;

            // Validate coupon
            if (!coupon.isActive || (coupon.expiryDate && new Date(coupon.expiryDate) < new Date())) {
                throw new ApiError(400, 'Coupon is expired or inactive');
            }

            if (coupon.maxUses && coupon.currentUses >= coupon.maxUses) {
                throw new ApiError(400, 'Coupon usage limit reached');
            }

            // Check if user has already used this coupon (for non-reusable coupons)
            if (!coupon.isReusable) {
                const existingUsage = await CouponUsage.findOne({
                    coupon: coupon._id,
                    user: userId,
                });

                if (existingUsage) {
                    throw new ApiError(400, 'You have already used this coupon');
                }
            }

            // Check minimum order amount
            if (coupon.minimumOrderAmount && amount < coupon.minimumOrderAmount) {
                throw new ApiError(400, `Minimum order amount of ₹${coupon.minimumOrderAmount} required for this coupon`);
            }

            // NEW: Validate coupon applicability to this pricing type and plan
            if (!coupon.isApplicableToPricingType('chat')) {
                throw new ApiError(400, "This coupon cannot be used for chat services");
            }

            // NEW: Check if coupon is restricted to specific pricing IDs
            if (coupon.applicablePricingIds.length > 0 &&
                !coupon.isApplicableToPricingId(planId)) {
                throw new ApiError(400, "This coupon cannot be used with this plan");
            }

            let finalAmount = amount;
            let discountAmount = 0;
            let extendedDays = 0;

            // Apply discount based on coupon type
            switch (coupon.discountType) {
                case 'percentage':
                    // discountAmount = amount * (coupon.discountValue / 100);
                    // finalAmount = amount - discountAmount;

                    extendedDays = (coupon.discountValue / 100) * (amount / (amount / plan.validityDays));

                    break;

                case 'fixed':
                    discountAmount = Math.min(coupon.discountValue, amount);
                    finalAmount = amount - discountAmount;
                    break;

                case 'free_days':
                    extendedDays = coupon.discountValue;
                    break;

                default:
                    throw new ApiError(400, 'Invalid coupon type');
            }

            // Ensure final amount is not negative
            // Round to nearest 0.5 days
            extendedDays = Math.round(extendedDays * 2) / 2;

            return {
                coupon,
                finalAmount: amount, // Keep original amount
                discountAmount: 0, // No amount discount
                extendedDays,
            };
        } catch (error) {
            console.error('Coupon processing error:', error);
            if (error instanceof ApiError) {
                await sendNotification(userId, 'Coupon Error', error.message);
            }
            return null;
        }
    },

    /**
     * Validates payment signature
     * @param {Object} paymentData - Payment data from Razorpay
     */
    validatePayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
        try {
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            if (expectedSignature !== razorpay_signature) {
                throw new ApiError(400, 'Payment verification failed: Invalid signature');
            }
        } catch (error) {
            console.error('Payment validation error:', error);
            throw new ApiError(400, 'Payment validation failed');
        }
    },

    /**
     * Processes payment capture
     * @param {Object} paymentData - Payment data
     * @param {number} amount - Amount to capture
     * @returns {Promise<Object>} Payment details
     */
    async processPayment(paymentData, amount) {
        try {
            // First, fetch the payment details to check its status
            const payment = await instance.payments.fetch(paymentData.razorpay_payment_id);

            if (!payment) {
                throw new ApiError(400, 'Payment not found');
            }

            // Check if payment is already captured
            if (payment.status === 'captured') {
                return {
                    status: 'success',
                    transactionId: paymentData.razorpay_order_id,
                    paymentId: payment.id,
                    signature: paymentData.razorpay_signature,
                    amount: payment.amount / 100, // Convert back from paise
                    gatewayResponse: payment,
                    completedAt: new Date(payment.created_at * 1000),
                    alreadyCaptured: true
                };
            }

            // If not captured, proceed with capture
            if (payment.status === 'authorized') {
                const capturedPayment = await instance.payments.capture(
                    paymentData.razorpay_payment_id,
                    Math.round(amount * 100), // Convert to paise
                    'INR'
                );

                return {
                    status: 'success',
                    transactionId: paymentData.razorpay_order_id,
                    paymentId: capturedPayment.id,
                    signature: paymentData.razorpay_signature,
                    amount,
                    gatewayResponse: capturedPayment,
                    completedAt: new Date()
                };
            }

            // Handle other statuses (failed, etc.)
            throw new ApiError(400, `Payment is in invalid state: ${payment.status}`);

        } catch (error) {
            console.error('Payment processing error:', error);

            const errorMessage = error.message || 'Unknown payment processing error';
            await this.recordFailedPayment(
                paymentData.razorpay_order_id,
                paymentData.razorpay_payment_id,
                amount,
                errorMessage
            );

            throw new ApiError(400, `Payment processing failed: ${errorMessage}`);
        }
    },

    /**
     * Creates subscription record
     * @param {string} userId - User ID
     * @param {string} planId - Plan ID
     * @param {Object} paymentDetails - Payment details
     * @returns {Promise<Object>} Created subscription
     */
    async createSubscription(userId, planId, paymentDetails) {
        try {
            const plan = await ChatPremium.findById(planId);
            if (!plan) {
                throw new ApiError(404, 'Plan not found');
            }

            // Calculate expiry date with possible coupon extension
            const extendedDays = paymentDetails.extendedDays || 0;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + plan.validityDays + extendedDays);

            // Create payment record according to schema
            const paymentRecord = {
                gateway: 'RazorPay',
                transactionId: paymentDetails.transactionId,
                orderId: paymentDetails.transactionId, // Using transactionId as orderId if not provided
                paymentId: paymentDetails.paymentId,
                signature: paymentDetails.signature,
                amount: paymentDetails.amount,
                currency: 'INR',
                status: paymentDetails.status,
                gatewayResponse: paymentDetails.gatewayResponse,
                initiatedAt: paymentDetails.initiatedAt || new Date(),
                completedAt: paymentDetails.completedAt,
            };

            // Create subscription using schema method
            const subscription = await ChatUserPremium.create({
                user: userId,
                plan: planId,
                expiryDate,
                // remainingChats: plan.chatsAllowed,
                remainingCharacters: plan.charactersAllowed,
usageLogs: [],
                // usedChats: [],
                isActive: paymentDetails.status === 'success',
                payment: paymentRecord,
            });

            if (!subscription) {
                throw new ApiError(500, 'Failed to create subscription record');
            }

            // Record coupon usage if applicable
            if (paymentDetails.couponCode && paymentDetails.status === 'success') {
                const coupon = await Coupon.findOne({ code: paymentDetails.couponCode });
                if (coupon) {
                    await CouponUsage.create({
                        coupon: coupon._id,
                        user: userId,
                        discountApplied: paymentDetails.discountAmount || 0,
                        subscription: subscription._id,
                    });

                    // Update coupon usage count
                    coupon.currentUses += 1;
                    await coupon.save();
                }
            }

            // Send notification for successful payment
            if (paymentDetails.status === 'success') {
                let message = `Your payment of ₹${paymentDetails.amount} for ${plan.name} was successful.`;
                if (paymentDetails.couponCode) {
                    message += ` (Coupon ${paymentDetails.couponCode} applied, saved ₹${paymentDetails.discountAmount || 0})`;
                }
                if (extendedDays > 0) {
                    message += ` Your subscription has been extended by ${extendedDays} days.`;
                }

                await sendNotification(userId, 'Payment Successful', message);
            }

            return subscription;
        } catch (error) {
            console.error('Subscription creation error:', error);
            throw error instanceof ApiError ? error : new ApiError(500, `Failed to create subscription: ${error.message}`);
        }
    },

    /**
     * Handles successful payment from webhook
     * @param {Object} payment - Payment data from webhook
     * @returns {Promise<Object>} Updated or created subscription
     */
    async handlePaymentSuccess(payment) {
        try {
            if (!payment || !payment.order_id) {
                throw new ApiError(400, 'Invalid payment data in webhook');
            }

            // Get order details to retrieve user and plan information
            const order = await instance.orders.fetch(payment.order_id);
            if (!order.notes || !order.notes.userId || !order.notes.planId) {
                throw new ApiError(400, 'Missing user or plan information in order notes');
            }

            const { userId, planId, couponCode, originalAmount, discountAmount, extendedDays } = order.notes;

            // Check if subscription already exists
            const existingSub = await ChatUserPremium.findOne({
                'payment.transactionId': payment.order_id,
            });

            if (existingSub) {
                // Update existing subscription
                const updatedSub = await ChatUserPremium.findOneAndUpdate(
                    { 'payment.transactionId': payment.order_id },
                    {
                        $set: {
                            'payment.status': 'success',
                            'payment.paymentId': payment.id,
                            'payment.signature': payment.signature || existingSub.payment.signature,
                            'payment.gatewayResponse': payment,
                            'payment.completedAt': new Date(),
                            isActive: true,
                        },
                    },
                    { new: true }
                );

                // Send notification
                const plan = await ChatPremium.findById(planId);
                if (plan) {
                    let message = `Your payment of ₹${payment.amount / 100} for ${plan.name} was successful.`;
                    if (couponCode) {
                        message += ` (Coupon ${couponCode} applied, saved ₹${discountAmount || 0})`;
                    }

                    await sendNotification(userId, 'Payment Successful', message);
                }

                return updatedSub;
            }

            // Create new subscription if not exists
            const plan = await ChatPremium.findById(planId);
            if (!plan) {
                throw new ApiError(404, 'Plan not found');
            }

            // Calculate expiry date with possible coupon extension
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + plan.validityDays + (extendedDays || 0));

            // Create payment record according to schema
            const paymentRecord = {
                gateway: 'RazorPay',
                transactionId: payment.order_id,
                orderId: payment.order_id,
                paymentId: payment.id,
                signature: payment.signature || '',
                amount: payment.amount / 100,
                currency: payment.currency,
                status: 'success',
                gatewayResponse: payment,
                initiatedAt: new Date(payment.created_at * 1000),
                completedAt: new Date(),
            };

            // Create subscription
            const subscription = await ChatUserPremium.create({
                user: userId,
                plan: planId,
                expiryDate,
                remainingChats: plan.chatsAllowed,
                usedChats: [],
                isActive: true,
                payment: paymentRecord,
            });

            // Record coupon usage if applicable
            if (couponCode) {
                const coupon = await Coupon.findOne({ code: couponCode });
                if (coupon) {
                    await CouponUsage.create({
                        coupon: coupon._id,
                        user: userId,
                        discountApplied: discountAmount || 0,
                        subscription: subscription._id,
                    });

                    // Update coupon usage count
                    coupon.currentUses += 1;
                    await coupon.save();
                }
            }

            // Send notification
            let message = `Your payment of ₹${payment.amount / 100} for ${plan.name} was successful.`;
            if (couponCode) {
                message += ` (Coupon ${couponCode} applied, saved ₹${discountAmount || 0})`;
            }
            if (extendedDays > 0) {
                message += ` Your subscription has been extended by ${extendedDays} days.`;
            }

            await sendNotification(userId, 'Payment Successful', message);

            return subscription;
        } catch (error) {
            console.error('Error in handlePaymentSuccess:', error);
            throw error instanceof ApiError ? error : new ApiError(500, `Payment success handling failed: ${error.message}`);
        }
    },

    /**
     * Handles failed payment from webhook
     * @param {Object} payment - Payment data from webhook
     * @returns {Promise<void>}
     */
    async handlePaymentFailure(payment) {
        try {
            if (!payment || !payment.order_id) {
                throw new ApiError(400, 'Invalid payment data in webhook');
            }

            // Get order details to retrieve user information
            const order = await instance.orders.fetch(payment.order_id);
            if (!order.notes || !order.notes.userId) {
                throw new ApiError(400, 'Missing user information in order notes');
            }

            const { userId, planId } = order.notes;

            const plan = await ChatPremium.findById(planId);
            if (!plan) {
                throw new ApiError(404, 'Plan not found');
            }

            await ChatUserPremium.findOneAndUpdate(
                { 'payment.transactionId': payment.order_id },
                {
                    $set: {
                        user: userId,
                        plan: planId,
                        expiryDate: new Date(new Date().getTime() + plan.validityDays * 24 * 60 * 60 * 1000),
                        remainingChats: plan.chatsAllowed,
                        usedChats: [],
                        isActive: false,
                        'payment.status': 'failed',
                        'payment.paymentId': payment.id,
                        'payment.signature': payment.signature || '',
                        'payment.gatewayResponse': payment,
                        'payment.completedAt': new Date(),
                    },
                },
                { upsert: true, new: true }
            );

            // Send notification
            await sendNotification(userId, 'Payment Failed', 'Your payment for premium subscription failed. Please try again.');
        } catch (error) {
            console.error('Error in handlePaymentFailure:', error);
            throw error instanceof ApiError ? error : new ApiError(500, `Payment failure handling failed: ${error.message}`);
        }
    },

    /**
     * Records failed payment attempt
     * @param {string} orderId - Order ID
     * @param {string} paymentId - Payment ID
     * @param {number} amount - Amount
     * @param {string} error - Error message
     * @returns {Promise<void>}
     */
    async recordFailedPayment(orderId, paymentId, amount, error) {
        try {
            const order = await instance.orders.fetch(orderId);
            if (!order.notes || !order.notes.userId || !order.notes.planId) {
                throw new ApiError(400, 'Missing user or plan information in order notes');
            }

            const { userId, planId } = order.notes;

            const plan = await ChatPremium.findById(planId);
            if (!plan) {
                throw new ApiError(404, 'Plan not found');
            }

            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + plan.validityDays);

            await ChatUserPremium.create({
                user: userId,
                plan: planId,
                expiryDate,
                remainingChats: plan.chatsAllowed,
                usedChats: [],
                isActive: false,
                payment: {
                    gateway: 'RazorPay',
                    transactionId: orderId,
                    orderId: orderId,
                    paymentId: paymentId,
                    amount: amount,
                    currency: 'INR',
                    status: 'failed',
                    gatewayResponse: { error },
                    initiatedAt: new Date(),
                    completedAt: new Date(),
                },
            });

            // Send notification
            await sendNotification(
                userId,
                'Payment Failed',
                `Your payment of ₹${amount} failed. Please try again. Error: ${error}`
            );
        } catch (error) {
            console.error('Failed to record failed payment:', error);
            // Fallback to minimal record if full creation fails
            try {
                await ChatUserPremium.create({
                    payment: {
                        gateway: 'RazorPay',
                        transactionId: orderId,
                        orderId: orderId,
                        paymentId: paymentId,
                        amount: amount,
                        currency: 'INR',
                        status: 'failed',
                        gatewayResponse: { error },
                        initiatedAt: new Date(),
                        completedAt: new Date(),
                    },
                });
            } catch (fallbackError) {
                console.error('Fallback failed payment recording also failed:', fallbackError);
            }
        }
    },

    /**
     * Verifies webhook signature
     * @param {Object} req - Express request object
     */
    verifyWebhookSignature(req) {
        try {
            const signature = req.headers['x-razorpay-signature'];
            if (!signature) {
                throw new ApiError(400, 'Missing Razorpay signature header');
            }

            const rawBody = req.rawBody;
            if (!rawBody) {
                throw new ApiError(400, 'Missing webhook body');
            }

            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            if (!webhookSecret) {
                throw new ApiError(500, 'Webhook secret not configured');
            }

            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(rawBody)
                .digest('hex');

            if (signature !== expectedSignature) {
                console.error('Signature verification failed', {
                    received: signature,
                    expected: expectedSignature,
                    body: rawBody.toString('utf8').slice(0, 100) + '...',
                });
                throw new ApiError(400, 'Invalid webhook signature');
            }
        } catch (error) {
            console.error('Webhook verification error:', error);
            throw error instanceof ApiError ? error : new ApiError(500, `Webhook verification failed: ${error.message}`);
        }
    },
};

/**
 * Sends notification to user via Firebase Cloud Messaging
 * @param {string} userId - User ID
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} [screen] - Optional screen to navigate to in the client app
 * @returns {Promise<void>}
 */
async function sendNotification(userId, title, message, screen) {
    // Assuming you have the FCM device token stored in your database
    const user = await User.findById(userId);
    const deviceToken = user?.deviceToken;

    if (!deviceToken) {
        console.error('No device token found for user:', userId);
        return;
    }

    const payload = {
        notification: {
            title: title,
            body: message,
        },
        data: {
            screen: screen || '', // This will be used in the client app to navigate
        },
        token: deviceToken,
    };

    try {
        const response = await admin.messaging().send(payload);
        console.log('Notification sent successfully:', response);
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}
