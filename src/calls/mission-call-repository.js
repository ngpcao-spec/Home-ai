import { unwrap } from '../supabase/repositories/shared.js';

export function createMissionCallRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required');
  const rpc = async (name, args) => unwrap(await client.rpc(name, args), `calls.${name}`);
  return Object.freeze({
    start: missionId => rpc('start_mission_call', { target_mission_id: missionId }),
    current: missionId => rpc('get_current_mission_call', { target_mission_id: missionId }),
    answer: callId => rpc('answer_mission_call', { target_call_id: callId }),
    decline: callId => rpc('decline_mission_call', { target_call_id: callId }),
    end: callId => rpc('end_mission_call', { target_call_id: callId }),
  });
}

function validateTokenResponse(value, requiresPeer) {
  const identity = /^ha_[0-9a-f]{40}$/;
  if (!value || typeof value.accessToken !== 'string' || value.accessToken.split('.').length !== 3
      || !identity.test(value.userId) || !Number.isInteger(value.expiresAt)) {
    throw new Error('Invalid Stringee token response');
  }
  if (requiresPeer && (!identity.test(value.peerUserId) || !['caller', 'callee'].includes(value.participantRole))) {
    throw new Error('Invalid Stringee peer response');
  }
  return Object.freeze({
    accessToken: value.accessToken,
    userId: value.userId,
    expiresAt: value.expiresAt,
    ...(requiresPeer ? { peerUserId: value.peerUserId, participantRole: value.participantRole } : {}),
  });
}

export function createStringeeTokenProvider(client) {
  if (!client?.functions?.invoke) throw new TypeError('A Supabase Functions client is required');
  return Object.freeze({
    async issue(missionCallId = null) {
      const body = missionCallId ? { missionCallId } : {};
      const result = await client.functions.invoke('issue-stringee-token', { body });
      return validateTokenResponse(unwrap(result, 'calls.issueStringeeToken'), Boolean(missionCallId));
    },
  });
}
