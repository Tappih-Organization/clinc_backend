/**
 * Job: send appointment reminders based on Settings (appointment_reminder trigger + reminderWindows).
 * Run periodically (e.g. every 15 min). Finds appointments in each reminder window and sends WhatsApp.
 */

import mongoose from 'mongoose';
import Settings from '../models/Settings';
import Clinic from '../models/Clinic';
import Appointment from '../models/Appointment';
import AppointmentReminderSent from '../models/AppointmentReminderSent';
import { sendNotification } from '../utils/notificationService';

const RUN_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const WINDOW_TOLERANCE_MS = 8 * 60 * 1000; // 8 min before/after target (so 16 min window)

function windowKey(days: number, hours: number): string {
  return `${days}d_${hours}h`;
}

function windowToMs(days: number, hours: number): number {
  return days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000;
}

export async function runAppointmentReminderJob(): Promise<void> {
  try {
    const now = new Date();
    const nowMs = now.getTime();

    const allSettings = await Settings.find({}).lean();
    const settingsList = allSettings.filter((s: any) => {
      const trigger = s?.notifications?.triggers?.appointment_reminder;
      return trigger?.enabled === true && Array.isArray(trigger?.reminderWindows) && trigger.reminderWindows.length > 0;
    });

    for (const settings of settingsList) {
      const mainClinicIdStr = settings.clinicId;
      if (!mainClinicIdStr) continue;

      const triggers = (settings.notifications as any)?.triggers;
      const reminderConfig = triggers?.appointment_reminder;
      const windows: { days: number; hours: number }[] = reminderConfig?.reminderWindows ?? [{ days: 1, hours: 0 }];
      if (!Array.isArray(windows) || windows.length === 0) continue;

      const mainClinicId = new mongoose.Types.ObjectId(mainClinicIdStr);
      const clinics = await Clinic.find({
        $or: [{ _id: mainClinicId }, { parent_clinic_id: mainClinicId }],
      })
        .select('_id')
        .lean();
      const clinicIds = clinics.map((c) => c._id);

      for (const w of windows) {
        const days = Number(w.days) || 0;
        const hours = Number(w.hours) || 0;
        const targetMs = nowMs + windowToMs(days, hours);
        const rangeStart = new Date(targetMs - WINDOW_TOLERANCE_MS);
        const rangeEnd = new Date(targetMs + WINDOW_TOLERANCE_MS);
        const key = windowKey(days, hours);

        const appointments = await Appointment.find({
          clinic_id: { $in: clinicIds },
          appointment_date: { $gte: rangeStart, $lte: rangeEnd },
          status: { $in: ['scheduled', 'confirmed'] },
        })
          .populate('patient_id', 'first_name last_name phone')
          .populate('doctor_id', 'first_name last_name')
          .lean();

        for (const apt of appointments) {
          const appointmentId = (apt as any)._id;
          const clinicId = (apt as any).clinic_id;
          const alreadySent = await AppointmentReminderSent.findOne({
            appointment_id: appointmentId,
            window_key: key,
          });
          if (alreadySent) continue;

          const patient: any = (apt as any).patient_id;
          const doctor: any = (apt as any).doctor_id;
          const phone = patient?.phone;
          if (!phone) continue;

          const clinic = await Clinic.findById(clinicId).select('name').lean();
          const date = (apt as any).appointment_date instanceof Date
            ? (apt as any).appointment_date
            : new Date((apt as any).appointment_date);
          const payload = {
            patient_name: patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : '',
            patient_phone: phone,
            appointment_date: date.toLocaleDateString('ar-SA'),
            appointment_time: date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
            doctor_name: doctor ? `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim() : '',
            clinic_name: (clinic as any)?.name || '',
          };

          await sendNotification('appointment_reminder', String(clinicId), {
            recipientPhone: phone,
            payload,
            lang: 'ar',
          });

          await AppointmentReminderSent.create({
            appointment_id: appointmentId,
            clinic_id: clinicId,
            window_key: key,
            sent_at: new Date(),
          }).catch((err) => console.error('[reminderJob] Failed to record sent:', err));
        }
      }
    }
  } catch (err: any) {
    console.error('[reminderJob] Error:', err?.message || err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startAppointmentReminderJob(): void {
  if (intervalId) return;
  runAppointmentReminderJob(); // run once on start
  intervalId = setInterval(runAppointmentReminderJob, RUN_INTERVAL_MS);
  console.log('[reminderJob] Started (every 3 min)');
}

export function stopAppointmentReminderJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[reminderJob] Stopped');
  }
}
