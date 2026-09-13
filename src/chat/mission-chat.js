import { chatShortcuts, missionAllowsChat } from './mission-chat-repository.js';

export function createMissionChatButton(mission, enabled = true) {
  return enabled && missionAllowsChat(mission)
    ? '<button type="button" data-mission-chat-open>💬 Nhắn tin <span data-chat-unread hidden></span></button>' : '';
}
const managers = new WeakMap();
export function getGlobalMissionChat(options) {
  const doc = options.documentRef ?? globalThis.document;
  if (!managers.has(doc)) managers.set(doc, createMissionChat({...options,documentRef:doc}));
  return managers.get(doc);
}

// Owned by the document, independent of mission rendering and of the Call Manager.
// observe() is fed by the existing mission Realtime/polling; no new timer/channel.
export function createMissionChat({documentRef:doc = globalThis.document,userId,role,messages}) {
  if (!userId || !messages) throw new TypeError('Authenticated chat services required');
  if (!doc.querySelector('[data-mission-chat-styles]')) {
    const link = doc.createElement('link');link.rel='stylesheet';link.href=new URL('./mission-chat.css',import.meta.url).href;
    link.dataset.missionChatStyles='';doc.head.append(link);
  }
  const host = doc.createElement('div');host.dataset.missionChatLayer='';doc.body.append(host);
  let mission=null;let opened=false;let busy=false;let disposed=false;let unread=0;let generation=0;let pendingRefresh=null;
  let baseline=false;let shortcutStatus=null;const rows=new Map();
  const notice = text => {const e=host.querySelector('[data-chat-error]');if(e){e.textContent=text;e.hidden=!text;}};
  const controls = () => {
    host.querySelectorAll('[data-chat-send],[data-chat-quick]').forEach(e=>{e.disabled=busy;});
    doc.querySelectorAll('[data-chat-unread]').forEach(e=>{e.textContent=String(unread);e.hidden=!unread;});
  };
  const clear = () => {generation++;mission=null;opened=false;busy=false;unread=0;baseline=false;shortcutStatus=null;rows.clear();host.replaceChildren();controls();};
  const append = row => {
    const list=host.querySelector('[data-chat-thread]');if(!list||list.querySelector(`[data-message-id="${row.id}"]`))return;
    const item=doc.createElement('li');item.dataset.messageId=row.id;item.className=row.sender_user_id===userId?'chat-own':'chat-peer';
    const body=doc.createElement('p');body.textContent=row.body;const time=doc.createElement('time');time.dateTime=row.created_at;
    time.textContent=new Date(row.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});item.append(body,time);list.append(item);
  };
  const merge = incoming => {
    const list=host.querySelector('[data-chat-thread]');const atBottom=!list||list.scrollHeight-list.scrollTop-list.clientHeight<60;
    for(const row of incoming??[]) {
      if(row.mission_id!==mission?.id||!/^[-0-9a-f]{36}$/i.test(row.id??'')||typeof row.body!=='string'||rows.has(row.id))continue;
      rows.set(row.id,row);if(baseline&&!opened&&row.sender_user_id!==userId)unread++;append(row);
    }
    baseline=true;controls();if(list&&atBottom)list.scrollTop=list.scrollHeight;
  };
  const shortcuts = () => {
    if(!opened||shortcutStatus===mission?.status)return;
    shortcutStatus=mission.status;const area=host.querySelector('[data-chat-shortcuts]');area.replaceChildren();
    for(const body of chatShortcuts(role,mission.status)) {const b=doc.createElement('button');b.type='button';b.dataset.chatQuick=body;b.textContent=body;area.append(b);}
    const other=doc.createElement('button');other.type='button';other.dataset.chatOther='';other.textContent='Khác';area.append(other);controls();
  };
  const open = () => {
    if(!missionAllowsChat(mission)||disposed)return;
    if(opened)return;opened=true;unread=0;shortcutStatus=null;
    host.innerHTML='<section class="mission-chat" role="dialog" aria-modal="true" aria-labelledby="mission-chat-title"><header><h2 id="mission-chat-title">Nhắn tin</h2><button type="button" data-chat-close aria-label="Đóng">×</button></header><p class="chat-temporary">Tin nhắn chỉ được lưu trong thời gian thực hiện nhiệm vụ.</p><ol data-chat-thread role="log" aria-live="polite"></ol><p data-chat-error role="alert" hidden></p><div data-chat-shortcuts></div><form data-chat-form hidden><label>Tin nhắn (tối đa 500 ký tự)<textarea data-chat-body maxlength="500" rows="2"></textarea></label><button type="submit" data-chat-send>Gửi</button></form></section>';
    for(const row of [...rows.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)))append(row);
    shortcuts();controls();void refresh();
  };
  const refresh = () => {
    if(!missionAllowsChat(mission)||disposed)return Promise.resolve();
    if(pendingRefresh?.id===mission.id)return pendingRefresh.promise;
    const id=mission.id;const epoch=generation;
    const promise=messages.list(id).then(data=>{if(!disposed&&epoch===generation&&mission?.id===id){merge(data);notice('');}})
      .catch(()=>{if(epoch===generation)notice('Không thể tải tin nhắn. Vui lòng thử lại.');})
      .finally(()=>{if(pendingRefresh?.promise===promise)pendingRefresh=null;});
    pendingRefresh={id,promise};return promise;
  };
  const send = async body => {
    if(busy||!missionAllowsChat(mission)||disposed)return;
    const value=body.trim();if(!value||[...value].length>500){notice('Vui lòng nhập từ 1 đến 500 ký tự.');return;}
    const id=mission.id;const epoch=generation;busy=true;controls();notice('');
    try {const row=await messages.send(id,value);if(epoch===generation&&!disposed){merge([row]);const input=host.querySelector('[data-chat-body]');if(input)input.value='';}}
    catch {if(epoch===generation)notice('Không thể gửi tin nhắn. Vui lòng thử lại.');}
    finally {if(epoch===generation){busy=false;controls();}}
  };
  const click = e => {
    if(e.target.closest('[data-mission-chat-open]')){open();return;}
    if(!host.contains(e.target))return;
    if(e.target.closest('[data-chat-close]')){opened=false;shortcutStatus=null;host.replaceChildren();return;}
    if(e.target.closest('[data-chat-other]')){const f=host.querySelector('[data-chat-form]');f.hidden=false;f.querySelector('textarea').focus();return;}
    const quick=e.target.closest('[data-chat-quick]');if(quick)void send(quick.dataset.chatQuick);
  };
  const submit = e => {if(e.target.matches('[data-chat-form]')){e.preventDefault();void send(e.target.querySelector('textarea').value);}};
  doc.addEventListener('click',click);host.addEventListener('submit',submit);
  return Object.freeze({
    observe(snapshot) {
      if(disposed)return;
      const next=snapshot?.mission;if(!missionAllowsChat(next)){clear();return;}
      if(next.id!==mission?.id)clear();mission=next;shortcuts();
      if(snapshot.messages)merge(snapshot.messages);if(snapshot.messageError)notice('Không thể tải tin nhắn. Vui lòng thử lại.');controls();
    },
    refresh,open,send,
    dispose(){disposed=true;clear();host.remove();doc.removeEventListener('click',click);host.removeEventListener('submit',submit);managers.delete(doc);},
  });
}
