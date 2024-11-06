// Utility function to get notification content based on type
export  const getNotificationContent = (type) => {
    switch (type) {
        case 'Recharges':
            return {
                title: 'Recharge Activated',
                body: 'Your Recharge has been successfully . Enjoy your benefits!',
            };
        
        case 'RechargesFailed':
            return {
                title: 'Payment Failed',
                body: 'There was an issue processing your payment. Please update your payment details.',
            };
        // Add more notification types as needed
        default:
            return {
                title: 'Notification',
                body: 'You have a new notification.',
            };
    }
};
