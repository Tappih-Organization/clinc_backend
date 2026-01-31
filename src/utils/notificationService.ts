/**
 * Notification service: sends notifications via Wawp WhatsApp API
 * using dynamic templates from Settings (triggers).
 * Notifications (Wawp + triggers) are at main-clinic level: sub-branches use main clinic settings.
 */

import Settings from '../models/Settings';
import Clinic from '../models/Clinic';
import { sendWawpMessage, phoneToChatId as wawpPhoneToChatId } from './wawp';

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
  /** Prescription: full formatted details (diagnosis + medications + notes) */
  prescription_details?: string;
  prescription_id?: string;
  diagnosis?: string;
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

/** Re-export for callers that expect it from here */
export const phoneToChatId = wawpPhoneToChatId;

/** Default WhatsApp template for new_appointment only when trigger is not in settings at all */
const DEFAULT_NEW_APPOINTMENT_TEMPLATE_AR =
  'مرحباً {{patient_name}} 👋\nموعدك عندنا بتاريخ {{appointment_date}} الساعة {{appointment_time}}\nالعيادة: {{clinic_name}}';
const DEFAULT_NEW_APPOINTMENT_TEMPLATE_EN =
  'Hello {{patient_name}} 👋\nYour appointment is on {{appointment_date}} at {{appointment_time}}\nClinic: {{clinic_name}}';

/**
 * Get WhatsApp template string from trigger config (from settings).
 * Supports: templates.whatsapp = { ar: string, en: string } or a single string.
 */
function getWhatsAppTemplateFromConfig(triggerConfig: any, lang: 'ar' | 'en'): string | undefined {
  if (!triggerConfig?.templates) return undefined;
  const whatsapp = triggerConfig.templates.whatsapp;
  if (typeof whatsapp === 'string' && whatsapp.trim()) return whatsapp.trim();
  if (whatsapp && typeof whatsapp === 'object') {
    const text = whatsapp[lang] ?? whatsapp.ar ?? whatsapp.en;
    return typeof text === 'string' && text.trim() ? text.trim() : undefined;
  }
  return undefined;
}

/**
 * Send notification for a trigger: loads clinic settings, gets template from settings (dynamic),
 * fills with payload, sends via WhatsApp if enabled.
 * Template is always taken from settings when the trigger is configured.
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

  // Notifications (Wawp + triggers) are at main-clinic level: sub-branches inherit from main
  let effectiveClinicId = clinicIdStr;
  const clinicDoc = await Clinic.findById(clinicIdStr).select('parent_clinic_id').lean();
  if (clinicDoc?.parent_clinic_id) {
    effectiveClinicId = String(clinicDoc.parent_clinic_id);
  }

  const settings = await Settings.findOne({ clinicId: effectiveClinicId }).lean();
  if (!settings?.notifications) {
    console.warn('[notificationService] No settings or notifications for clinic (effective):', effectiveClinicId);
    return result;
  }

  const triggers = (settings.notifications as any)?.triggers;
  const triggerConfig = triggers?.[triggerId];
  const wawpConfig = (settings.notifications as any)?.wawp;
  const instanceId = wawpConfig?.instanceId || process.env.WAWP_INSTANCE_ID;
  const accessToken = wawpConfig?.accessToken || process.env.WAWP_ACCESS_TOKEN;
  const hasWawp = !!(instanceId?.trim() && accessToken?.trim());

  // Dynamic template from settings: use template defined in UI for this trigger
  let template: string | undefined;
  const isEnabled = triggerConfig?.enabled === true;
  const whatsappChannelOn = (triggerConfig as any)?.channels?.whatsapp === true;
  if (isEnabled && whatsappChannelOn) {
    template = getWhatsAppTemplateFromConfig(triggerConfig, lang);
  }

  // Fallback: only when this trigger is not configured at all (no trigger in settings)
  if (!template && !triggerConfig && triggerId === 'new_appointment' && hasWawp) {
    template = lang === 'en' ? DEFAULT_NEW_APPOINTMENT_TEMPLATE_EN : DEFAULT_NEW_APPOINTMENT_TEMPLATE_AR;
    console.log('[notificationService] Using default new_appointment template (trigger not in settings)');
  }

  if (!template) {
    if (!triggerConfig) {
      console.warn('[notificationService] Trigger not configured:', triggerId, 'clinic:', clinicIdStr);
    } else if (!isEnabled || !whatsappChannelOn) {
      console.warn('[notificationService] Trigger disabled or WhatsApp channel off:', triggerId);
    } else {
      console.warn('[notificationService] No WhatsApp template for trigger (set template in Settings → Notifications):', triggerId);
    }
    return result;
  }

  const message = fillTemplate(template, payload);
  const chatId = wawpPhoneToChatId(recipientPhone);
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

  const sendResult = await sendWawpMessage(instanceId!, accessToken!, chatId, message);
  result.whatsapp = { success: sendResult.success, error: sendResult.error };
  if (!sendResult.success) {
    console.error('[notificationService] Send failed:', triggerId, sendResult.error);
  }
  return result;
}
