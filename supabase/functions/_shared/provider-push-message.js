export const CHAT_PUSH_STATUSES = Object.freeze([
  'accepted', 'travelling', 'arrived', 'quote_pending', 'in_progress',
  'supplement_pending', 'completed_pending_payment',
]);

export function isProviderMessagePushDeliverable(outbox, message, mission) {
  return Boolean(outbox?.message_id && message?.id === outbox.message_id
    && message.mission_id === mission?.id
    && message.sender_user_id === mission.client_id
    && mission.provider_id === outbox.provider_id
    && CHAT_PUSH_STATUSES.includes(mission.status));
}

export function providerMessagePushPayload(messageId) {
  return {
    type: 'mission_message',
    messageRef: messageId,
    title: 'HOME AI',
    body: 'Tin nhắn mới từ khách hàng',
  };
}

export function shouldSendProviderPush(subscription, now = Date.now()) {
  return !subscription.foreground_until || new Date(subscription.foreground_until).getTime() <= now;
}
