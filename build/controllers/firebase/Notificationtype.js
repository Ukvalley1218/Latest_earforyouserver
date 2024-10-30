// Utility function to get notification content based on type
export const getNotificationContent = type => {
  switch (type) {
    case 'subscriptionActivated':
      return {
        title: 'Subscription Activated',
        body: 'Your subscription has been successfully activated. Enjoy your benefits!'
      };
    case 'subscriptionExpired':
      return {
        title: 'Subscription Expired',
        body: 'Your subscription has expired. Please renew it to continue enjoying our services.'
      };
    case 'paymentFailed':
      return {
        title: 'Payment Failed',
        body: 'There was an issue processing your payment. Please update your payment details.'
      };
    // Add more notification types as needed
    default:
      return {
        title: 'Notification',
        body: 'You have a new notification.'
      };
  }
};