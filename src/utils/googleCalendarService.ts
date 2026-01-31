/**
 * Google Calendar sync service.
 * Syncs clinic appointments to Google Calendar when enabled in settings.
 */
import { google, calendar_v3 } from 'googleapis';
import Settings from '../models/Settings';
import Appointment from '../models/Appointment';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export interface GoogleCalendarCredentials {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  calendarId?: string;
}

/**
 * Get OAuth2 client for Google Calendar (no token - for auth URL).
 */
export function getOAuth2Client(clientId: string, clientSecret: string, redirectUri: string) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Build authorization URL for user to grant calendar access.
 * state should be clinicId so callback knows where to save refresh_token.
 */
export function getAuthUrl(clientId: string, clientSecret: string, redirectUri: string, state: string): string {
  const oauth2 = getOAuth2Client(clientId, clientSecret, redirectUri);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

/**
 * Exchange authorization code for tokens and return refresh_token.
 */
export async function getRefreshTokenFromCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<string> {
  const oauth2 = getOAuth2Client(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token in response - user may have already authorized. Revoke access and try again.');
  }
  return tokens.refresh_token;
}

/**
 * Get credentials from env (API-only; not stored in DB).
 */
function getEnvCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Get Calendar API client for a clinic (uses env Client ID/Secret + stored refresh_token).
 */
async function getCalendarClient(clinicId: string): Promise<{ calendar: calendar_v3.Calendar; calendarId: string } | null> {
  const creds = getEnvCredentials();
  if (!creds) return null;
  const settings = await Settings.findOne({ clinicId: String(clinicId) }).lean();
  const gc = settings?.notifications?.googleCalendar as GoogleCalendarCredentials | undefined;
  if (!gc?.enabled || !gc.refreshToken?.trim()) return null;
  const redirectUri = getRedirectUri();
  const oauth2 = getOAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: gc.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const calendarId = gc.calendarId || 'primary';
  return { calendar, calendarId };
}

function getRedirectUri(): string {
  const base = process.env.BACKEND_URL || process.env.GOOGLE_CALENDAR_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}`;
  return `${base.replace(/\/$/, '')}/api/settings/google-calendar/callback`;
}

/**
 * Build calendar event resource from appointment (populated).
 */
function appointmentToEventResource(appointment: any): calendar_v3.Schema$Event {
  const date = appointment.appointment_date instanceof Date ? appointment.appointment_date : new Date(appointment.appointment_date);
  const endDate = new Date(date.getTime() + (appointment.duration || 30) * 60 * 1000);
  const patient = appointment.patient_id;
  const doctor = appointment.doctor_id;
  const patientName = patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : 'Patient';
  const doctorName = doctor ? `د. ${doctor.first_name || ''} ${doctor.last_name || ''}`.trim() : '';
  const title = `موعد - ${patientName}${doctorName ? ` (${doctorName})` : ''}`;
  const description = [
    appointment.reason ? `السبب: ${appointment.reason}` : '',
    appointment.notes ? `ملاحظات: ${appointment.notes}` : '',
    doctorName ? `الطبيب: ${doctorName}` : '',
  ].filter(Boolean).join('\n');
  return {
    summary: title,
    description: description || undefined,
    start: { dateTime: date.toISOString(), timeZone: 'Asia/Riyadh' },
    end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Riyadh' },
  };
}

/**
 * Sync appointment to Google Calendar (create or update).
 * Updates appointment.google_calendar_event_id if a new event is created.
 */
export async function syncAppointmentToCalendar(clinicId: string, appointment: any): Promise<void> {
  const client = await getCalendarClient(clinicId);
  if (!client) return;
  const { calendar, calendarId } = client;
  const eventResource = appointmentToEventResource(appointment);
  const eventId = appointment.google_calendar_event_id;
  try {
    if (eventId) {
      await calendar.events.update({
        calendarId,
        eventId,
        requestBody: eventResource,
      });
    } else {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: eventResource,
      });
      const id = res.data.id;
      if (id && appointment._id) {
        await Appointment.findByIdAndUpdate(appointment._id, { google_calendar_event_id: id });
      }
    }
  } catch (err) {
    console.error('[google-calendar] sync error:', err);
  }
}

/**
 * Delete event from Google Calendar when appointment is cancelled.
 */
export async function deleteAppointmentFromCalendar(clinicId: string, googleCalendarEventId: string): Promise<void> {
  if (!googleCalendarEventId) return;
  const client = await getCalendarClient(clinicId);
  if (!client) return;
  const { calendar, calendarId } = client;
  try {
    await calendar.events.delete({
      calendarId,
      eventId: googleCalendarEventId,
    });
  } catch (err: any) {
    if (err?.code !== 404) {
      console.error('[google-calendar] delete error:', err);
    }
  }
}
