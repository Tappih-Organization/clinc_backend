/**
 * Notification service: sends notifications via Wawp WhatsApp API
 * using dynamic templates from Settings (triggers).
 */

import Settings from '../models/Settings';

const WAWP_SEND_URL = 'https://wawp.net/wp-json/awp/v1/send';

export type TriggerId =
  | 'new_appointment'
  | 'edit_appointment'
  | 'cancel_appointment'
  | 'appointment_reminder'
  | 'new_invoice'
  | 'overdue_invoice'
  | 'new_prescription';

/** Payload keys match template tags: patient_name, appointment_date, etc. */
export interface NotificationPayload {
  patient_name?: string;
  patient_phone?: string;
  patient_email?: string;
  appointment_date?: string;
  appointment_time?: string;
  doctor_name?: string;
  clinic_name?: string;
  invoice_amount?: string;
  invoice_id?: string;
  payment_amount?: string;
  service_name?: string;
  test_name?: string;
  [key: string]: string | undefined;
}

/**
 * Replace {{tag}} in template with payload values.
 */
export function fillTemplate(template: string, payload: NotificationPayload): string {
  let result = template;
  for (const [key, value] of Object.entries(payload)) {
    if (value != null) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, String(value));
    }
  }
  return result;
}

/**
 * Normalize phone to Wawp chatId: digits only + @c.us (e.g. 966501234567@c.us).
 */
export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `${digits}@c.us` : '';
}

/**
 * Send a text message via Wawp WhatsApp API.
 * Uses WAWP_INSTANCE_ID and WAWP_ACCESS_TOKEN from env if wawpConfig not provided.
 */
export async function sendWawpWhatsApp(
  chatId: string,
  message: string,
  wawpConfig?: { instanceId: string; accessToken: string }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const instanceId = wawpConfig?.instanceId || process.env.WAWP_INSTANCE_ID;
  const accessToken = wawpConfig?.accessToken || process.env.WAWP_ACCESS_TOKEN;

  if (!instanceId || !accessToken) {
    console.warn('[notificationService] Wawp not configured: missing instanceId or accessToken');
    return { success: false, error: 'Wawp not configured' };
  }

  if (!chatId || !message) {
    return { success: false, error: 'chatId and message are required' };
  }

  const url = new URL(WAWP_SEND_URL);
  url.searchParams.set('instance_id', instanceId);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('chatId', chatId);
  url.searchParams.set('message', message);

  try {
    const res = await fetch(url.toString(), { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('[notificationService] Wawp API error:', res.status, data);
      return {
        success: false,
        error: (data as any)?.message || `HTTP ${res.status}`,
      };
    }

    const messageId = (data as any)?._data?.id?._serialized ?? (data as any)?.id;
    return { success: true, messageId };
  } catch (err: any) {
    console.error('[notificationService] Wawp request failed:', err?.message);
    return { success: false, error: err?.message || 'Request failed' };
  }
}

/** Default WhatsApp template for new_appointment when not configured in settings */
const DEFAULT_NEW_APPOINTMENT_TEMPLATE_AR =
  'مرحباً {{patient_name}} 👋\nموعدك عندنا بتاريخ {{appointment_date}} الساعة {{appointment_time}}\nالعيادة: {{clinic_name}}';
const DEFAULT_NEW_APPOINTMENT_TEMPLATE_EN =
  'Hello {{patient_name}} 👋\nYour appointment is on {{appointment_date}} at {{appointment_time}}\nClinic: {{clinic_name}}';

/**
 * Send notification for a trigger: loads clinic settings, gets template,
 * fills with payload, sends via WhatsApp if enabled.
 * For new_appointment, uses default template if trigger not configured but Wawp is.
 */
export async function sendNotification(
  triggerId: TriggerId,
  clinicId: string,
  options: {
    recipientPhone: string;
    payload: NotificationPayload;
    lang?: 'ar' | 'en';
  }
): Promise<{ whatsapp?: { success: boolean; error?: string } }> {
  const { recipientPhone, payload, lang = 'ar' } = options;
  const result: { whatsapp?: { success: boolean; error?: string } } = {};
  const clinicIdStr = String(clinicId);

  const settings = await Settings.findOne({ clinicId: clinicIdStr }).lean();
  if (!settings?.notifications) {
    console.warn('[notificationService] No settings or notifications for clinic:', clinicIdStr);
    return result;
  }

  const triggers = (settings.notifications as any)?.triggers;
  const triggerConfig = triggers?.[triggerId];
  const wawpConfig = (settings.notifications as any)?.wawp;
  const hasWawp = !!(wawpConfig?.instanceId && wawpConfig?.accessToken) ||
    !!(process.env.WAWP_INSTANCE_ID && process.env.WAWP_ACCESS_TOKEN);

  let template: string | undefined;
  if (triggerConfig?.enabled && triggerConfig?.channels?.whatsapp) {
    const templates = triggerConfig.templates?.whatsapp;
    template = templates?.[lang] || templates?.ar || templates?.en;
  }

  // Fallback: for new_appointment, send with default template if Wawp is configured but trigger not set
  if (!template && triggerId === 'new_appointment' && hasWawp) {
    template = lang === 'en' ? DEFAULT_NEW_APPOINTMENT_TEMPLATE_EN : DEFAULT_NEW_APPOINTMENT_TEMPLATE_AR;
    console.log('[notificationService] Using default new_appointment template (trigger not in settings)');
  }

  if (!template) {
    if (!triggerConfig) {
      console.warn('[notificationService] Trigger not configured:', triggerId, 'clinic:', clinicIdStr);
    } else if (!triggerConfig.enabled || !triggerConfig.channels?.whatsapp) {
      console.warn('[notificationService] Trigger disabled or WhatsApp channel off:', triggerId);
    } else {
      console.warn('[notificationService] No WhatsApp template for trigger:', triggerId);
    }
    return result;
  }

  const message = fillTemplate(template, payload);
  const chatId = phoneToChatId(recipientPhone);
  if (!chatId) {
    console.warn('[notificationService] Invalid phone number:', recipientPhone);
    result.whatsapp = { success: false, error: 'Invalid phone number' };
    return result;
  }

  if (!hasWawp) {
    console.warn('[notificationService] Wawp not configured (no instanceId/accessToken in settings or env)');
    result.whatsapp = { success: false, error: 'Wawp not configured' };
    return result;
  }

  const sendResult = await sendWawpWhatsApp(chatId, message, wawpConfig);
  result.whatsapp = { success: sendResult.success, error: sendResult.error };
  if (!sendResult.success) {
    console.error('[notificationService] Send failed:', triggerId, sendResult.error);
  }
  return result;
}
