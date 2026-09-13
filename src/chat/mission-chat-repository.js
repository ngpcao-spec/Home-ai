import { unwrap } from '../supabase/repositories/shared.js';

export const chatStatuses = Object.freeze(['accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment']);
export const missionAllowsChat = mission => Boolean(mission?.id && chatStatuses.includes(mission.status));
export function createMissionChatRepository(client) {
  return Object.freeze({
    async list(missionId) {
      return unwrap(await client.rpc('get_mission_messages', {target_mission_id:missionId}), 'chat.list') ?? [];
    },
    async send(missionId, body) {
      return unwrap(await client.rpc('send_mission_message', {target_mission_id:missionId,new_body:body}), 'chat.send');
    },
  });
}

export function chatShortcuts(role, status) {
  const provider = role === 'provider';
  if (status === 'travelling') return provider
    ? ['Tôi đang đi','Tôi sẽ đến trong 5 phút','Tôi sẽ đến trong 10 phút']
    : ['Bạn đã đi chưa?','Bao lâu nữa bạn đến?','Tôi đang chờ bạn'];
  if (status === 'arrived') return provider
    ? ['Tôi đã đến','Tôi đang ở trước cửa','Bạn có thể mở cửa không?']
    : ['Tôi ra ngay','Vui lòng chờ 5 phút','Tôi đang xuống'];
  if (status === 'accepted') return provider
    ? ['Tôi đã nhận yêu cầu','Tôi sẽ liên hệ khi đến','Bạn có hướng dẫn gì không?']
    : ['Tôi đang chờ bạn','Vui lòng báo khi bạn đến','Cảm ơn bạn'];
  if (status === 'completed_pending_payment') return provider
    ? ['Công việc đã hoàn thành','Vui lòng kiểm tra công việc','Vui lòng xác nhận thanh toán']
    : ['Tôi đang kiểm tra','Vui lòng chờ một chút','Cảm ơn bạn'];
  if (['quote_pending','supplement_pending'].includes(status)) return provider
    ? ['Vui lòng xem báo giá','Bạn có câu hỏi về báo giá không?','Tôi đang chờ xác nhận']
    : ['Tôi đang xem báo giá','Vui lòng giải thích thêm','Vui lòng chờ một chút'];
  return provider ? ['Bạn có yêu cầu gì thêm không?','Vui lòng kiểm tra','Tôi đang thực hiện công việc']
    : ['Tôi ra ngay','Vui lòng chờ một chút','Cảm ơn bạn'];
}
