import { describe, expect, it, vi } from 'vitest';

import { PushizoCore } from '../src/core';
import type { Bridge, BridgeEventType } from '../src/core';
import type { ChatEventMap, ChatMessage } from '../src/definitions';

/** Çağrıları kaydeden ve olay işleyicisini dışarı veren sahte taşıma katmanı. */
function fakeBridge(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args?: Record<string, unknown> }> = [];
  let handler: ((type: BridgeEventType, payload: unknown) => void) | null = null;
  const bridge: Bridge = {
    call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args });
      return responses[method] as never;
    }),
    subscribe: vi.fn((h: (type: BridgeEventType, payload: unknown) => void) => {
      handler = h;
    }),
  };
  return {
    bridge,
    calls,
    emit: (type: BridgeEventType, payload: unknown) => {
      if (!handler) throw new Error('abone olunmadı');
      handler(type, payload);
    },
  };
}

const message: ChatMessage = {
  id: 'cmsg_1',
  seq: 12,
  clientMessageId: 'm_abcdefgh',
  sender: 'bot',
  authorName: 'Asistan',
  text: 'Seçin',
  attachments: [{ id: 'att_1', name: 'a.png', type: 'image/png', size: 2048 }],
  quickReplies: [{ id: 'o1', label: 'Satış' }],
  status: 'delivered',
  createdAt: 1792490400000,
};

describe('PushizoCore.Chat', () => {
  it('çağrı argümanları köprüye iletilir, skaler yanıtlar açılır', async () => {
    const f = fakeBridge({
      chatMarkRead: { unreadCount: 0 },
      chatRefreshUnreadCount: { unreadCount: 3 },
      chatGetUnreadCount: { unreadCount: 3 },
      chatAttachmentUrl: { url: 'https://api.test/sdk/v1/apps/app_1/chat/attachments/att_1?visitor_id=v&token=t' },
      chatGetVisitorId: { visitorId: null },
      chatSendMessage: message,
    });
    const hs = new PushizoCore(f.bridge);
    await hs.Chat.start({ name: 'Ali' });
    await hs.Chat.getConfig('tr');
    await hs.Chat.getConversation();
    await hs.Chat.getMessages({ afterSeq: 5 });
    expect(await hs.Chat.sendMessage('Merhaba', { optionId: 'o1' })).toEqual(message);
    await hs.Chat.sendAttachment({ base64: 'AQID' }, { fileName: 'a.png', mimeType: 'image/png' });
    await hs.Chat.sendAttachment({ uri: 'file:///tmp/r.pdf' }, { fileName: 'r.pdf', mimeType: 'application/pdf; charset=binary', text: 'Rapor' });
    expect(await hs.Chat.markRead(12)).toBe(0);
    expect(await hs.Chat.refreshUnreadCount()).toBe(3);
    expect(await hs.Chat.getUnreadCount()).toBe(3);
    await hs.Chat.leaveOfflineMessage('ali@example.com', 'Arayın');
    await hs.Chat.setTyping(true);
    await hs.Chat.startListening();
    await hs.Chat.stopListening();
    expect(await hs.Chat.attachmentUrl('att_1')).toContain('/chat/attachments/att_1');
    expect(await hs.Chat.getVisitorId()).toBeNull();
    expect(f.calls.map((c) => [c.method, c.args])).toEqual([
      ['chatStart', { name: 'Ali' }],
      ['chatGetConfig', { language: 'tr' }],
      ['chatGetConversation', undefined],
      ['chatGetMessages', { limit: 50, afterSeq: 5 }],
      ['chatSendMessage', { text: 'Merhaba', optionId: 'o1' }],
      ['chatSendAttachment', { fileName: 'a.png', mimeType: 'image/png', base64: 'AQID' }],
      ['chatSendAttachment', { fileName: 'r.pdf', mimeType: 'application/pdf', uri: 'file:///tmp/r.pdf', text: 'Rapor' }],
      ['chatMarkRead', { seq: 12 }],
      ['chatRefreshUnreadCount', undefined],
      ['chatGetUnreadCount', undefined],
      ['chatLeaveOfflineMessage', { email: 'ali@example.com', text: 'Arayın' }],
      ['chatSetTyping', { typing: true }],
      ['chatStartListening', undefined],
      ['chatStopListening', undefined],
      ['chatAttachmentUrl', { attachmentId: 'att_1', download: false }],
      ['chatGetVisitorId', undefined],
    ]);
  });

  it('geçersiz argümanlar köprüye gitmeden reddedilir', async () => {
    const f = fakeBridge();
    const hs = new PushizoCore(f.bridge);
    await expect(hs.Chat.getMessages({ limit: 101 })).rejects.toThrow(RangeError);
    await expect(hs.Chat.getMessages({ beforeSeq: 0 })).rejects.toThrow(RangeError);
    expect(() => hs.Chat.sendMessage('   ')).toThrow(TypeError);
    expect(() => hs.Chat.sendMessage('a'.repeat(4001))).toThrow(RangeError);
    await expect(hs.Chat.markRead(-1)).rejects.toThrow(RangeError);
    await expect(hs.Chat.sendAttachment({ base64: 'AQID' }, { fileName: 'a.exe', mimeType: 'application/x-msdownload' })).rejects.toThrow(TypeError);
    expect(f.calls).toEqual([]);
  });

  it('native sohbet olayları türüne göre dağıtılır; açma tıklaması dinleyici gelene kadar bekletilir', async () => {
    const f = fakeBridge();
    const hs = new PushizoCore(f.bridge);
    const messages: ChatMessage[] = [];
    const typing: Array<ChatEventMap['typing']> = [];
    const removeMessage = hs.Chat.addEventListener('message', (e) => messages.push(e.message));
    hs.Chat.addEventListener('typing', (e) => typing.push(e));
    await Promise.resolve();

    f.emit('chatEvent', { type: 'message', message });
    f.emit('chatEvent', { type: 'typing', typing: true, name: 'Ayşe' });
    f.emit('chatEvent', { type: 'unread', count: 2 });
    f.emit('chatOpen', { conversationId: 'conv_9', seq: 4 });
    expect(messages).toEqual([message]);
    expect(typing).toEqual([{ typing: true, name: 'Ayşe' }]);

    removeMessage();
    f.emit('chatEvent', { type: 'message', message });
    expect(messages).toHaveLength(1);

    const opens: Array<ChatEventMap['open']> = [];
    hs.Chat.addEventListener('open', (e) => opens.push(e));
    expect(opens).toEqual([{ conversationId: 'conv_9', seq: 4 }]);
    f.emit('chatOpen', { conversationId: 'conv_10', seq: 5 });
    expect(opens).toHaveLength(2);
    expect(() => hs.Chat.addEventListener('bilinmeyen' as never, () => undefined)).toThrow(TypeError);
  });
});
