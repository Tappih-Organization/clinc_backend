import mongoose, { Schema, Document } from 'mongoose';

/**
 * Tracks which appointment reminder (per window) has already been sent
 * to avoid sending the same reminder twice.
 */
export interface IAppointmentReminderSent extends Document {
  appointment_id: mongoose.Types.ObjectId;
  clinic_id: mongoose.Types.ObjectId;
  /** e.g. "1d_0h" for 1 day 0 hours before */
  window_key: string;
  sent_at: Date;
}

const AppointmentReminderSentSchema = new Schema<IAppointmentReminderSent>(
  {
    appointment_id: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
    clinic_id: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
    window_key: { type: String, required: true },
    sent_at: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'appointment_reminder_sent' }
);

AppointmentReminderSentSchema.index({ appointment_id: 1, window_key: 1 }, { unique: true });

export default mongoose.model<IAppointmentReminderSent>('AppointmentReminderSent', AppointmentReminderSentSchema);
