import { Router } from 'express';
import { body, CustomValidator } from 'express-validator';
import { AppointmentController } from '../controllers';
import { authenticate, requireMedicalStaff } from '../middleware/auth';
import { clinicContext } from '../middleware/clinicContext';
import AppointmentStatus from '../models/AppointmentStatus';

const router = Router();

// Custom validator for dynamic appointment status
const validateAppointmentStatus: CustomValidator = async (value, { req }) => {
  if (!value) return true; // Optional field
  
  const tenant_id = (req as any).tenant_id;
  const clinic_id = (req as any).clinic_id;
  
  if (!tenant_id || !clinic_id) {
    throw new Error('Tenant and clinic context is required');
  }
  
  // Check if status exists in AppointmentStatus collection
  const statusExists = await AppointmentStatus.findOne({
    tenant_id,
    clinic_id,
    code: value.toLowerCase(),
    is_active: true
  });
  
  if (!statusExists) {
    throw new Error(`Status '${value}' does not exist or is not active for this clinic`);
  }
  
  return true;
};

// Validation middleware for creating appointments (all fields required)
const appointmentValidation = [
  body('patient_id').isMongoId().withMessage('Valid patient ID is required'),
  body('doctor_id').isMongoId().withMessage('Valid doctor ID is required'),
  body('nurse_id').optional().isMongoId().withMessage('Valid nurse ID is required if provided'),
  body('appointment_date').isISO8601().withMessage('Please provide a valid appointment date'),
  body('duration').isInt({ min: 15, max: 240 }).withMessage('Duration must be between 15 and 240 minutes'),
  body('type').isIn(['consultation', 'follow-up', 'check-up', 'vaccination', 'procedure', 'emergency', 'screening', 'therapy', 'other']).withMessage('Invalid appointment type'),
  body('status').optional().custom(validateAppointmentStatus),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters')
];

// Validation middleware for updating appointments (all fields optional)
const appointmentUpdateValidation = [
  body('patient_id').optional().isMongoId().withMessage('Valid patient ID is required'),
  body('doctor_id').optional().isMongoId().withMessage('Valid doctor ID is required'),
  body('nurse_id').optional().isMongoId().withMessage('Valid nurse ID is required if provided'),
  body('appointment_date').optional().isISO8601().withMessage('Please provide a valid appointment date'),
  body('duration').optional().isInt({ min: 15, max: 240 }).withMessage('Duration must be between 15 and 240 minutes'),
  body('type').optional().isIn(['consultation', 'follow-up', 'check-up', 'vaccination', 'procedure', 'emergency', 'screening', 'therapy', 'other']).withMessage('Invalid appointment type'),
  body('status').optional().custom(validateAppointmentStatus),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters')
];

// Routes - All appointment operations require authentication and clinic context
router.post('/', authenticate, clinicContext, appointmentValidation, AppointmentController.createAppointment);
router.get('/', authenticate, clinicContext, AppointmentController.getAllAppointments);
router.get('/stats', authenticate, clinicContext, AppointmentController.getAppointmentStats);
router.get('/upcoming', authenticate, clinicContext, AppointmentController.getUpcomingAppointments);
router.get('/doctor/:doctorId/schedule', authenticate, clinicContext, AppointmentController.getDoctorSchedule);
router.get('/:id', authenticate, clinicContext, AppointmentController.getAppointmentById);
router.put('/:id', authenticate, clinicContext, appointmentUpdateValidation, AppointmentController.updateAppointment);
router.patch('/:id/cancel', authenticate, clinicContext, AppointmentController.cancelAppointment);

export default router; 