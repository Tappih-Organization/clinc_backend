/**
 * Send a text message via Wawp WhatsApp API.
 */
const WAWP_SEND_URL = 'https://wawp.net/wp-json/awp/v1/send';

export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `${digits}@c.us` : '';
}

export async function sendWawpMessage(
  instanceId: string,
  accessToken: string,
  chatId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!instanceId?.trim() || !accessToken?.trim()) {
    return { success: false, error: 'Instance ID and Access Token are required' };
  }
  if (!chatId || !message?.trim()) {
    return { success: false, error: 'Phone number and message are required' };
  }

  const url = new URL(WAWP_SEND_URL);
  url.searchParams.set('instance_id', instanceId.trim());
  url.searchParams.set('access_token', accessToken.trim());
  url.searchParams.set('chatId', chatId);
  url.searchParams.set('message', message.trim());

  try {
    const res = await fetch(url.toString(), { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        error: (data as any)?.message || `HTTP ${res.status}`,
      };
    }

    const messageId = (data as any)?._data?.id?._serialized ?? (data as any)?.id;
    return { success: true, messageId };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Request failed' };
  }
}
