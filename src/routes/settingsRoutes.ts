import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  sendWhatsAppTestMessage,
  getGoogleCalendarAuthUrl,
  googleCalendarCallback,
  disconnectGoogleCalendar,
} from '../controllers/settingsController';
import { authenticate } from '../middleware/auth';
import { clinicContext } from '../middleware/clinicContext';

const router = Router();

// GET /api/settings - Get clinic settings
router.get('/', authenticate, clinicContext, getSettings);

// PUT /api/settings - Update clinic settings
router.put('/', authenticate, clinicContext, updateSettings);

// POST /api/settings/whatsapp-test - Send test WhatsApp message
router.post('/whatsapp-test', authenticate, clinicContext, sendWhatsAppTestMessage);

// Google Calendar OAuth: get auth URL (authenticated), callback (no auth - called by Google)
router.get('/google-calendar/auth-url', authenticate, clinicContext, getGoogleCalendarAuthUrl);
router.get('/google-calendar/callback', googleCalendarCallback);

// Disconnect Google Calendar
router.post('/google-calendar/disconnect', authenticate, clinicContext, disconnectGoogleCalendar);

export default router; 