import { Router } from 'express';
import { body, param } from 'express-validator';
import { validationResult } from 'express-validator';
import { AppointmentStatusController } from '../controllers/appointmentStatusController';
import { authenticate } from '../middleware/auth';
import { clinicContext } from '../middleware/clinicContext';

const router = Router();

// Validation middleware
const handleValidationErrors = (req: any, res: any, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// All routes require authentication and clinic context
router.use(authenticate);
router.use(clinicContext);

// Validation rules
const createStatusValidation = [
  body('code')
    .trim()
    .notEmpty().withMessage('Status code is required')
    .isLength({ min: 1, max: 50 }).withMessage('Status code must be between 1 and 50 characters')
    .matches(/^[a-z0-9-_]+$/).withMessage('Status code can only contain lowercase letters, numbers, hyphens, and underscores'),
  body('name_en')
    .trim()
    .notEmpty().withMessage('English name is required')
    .isLength({ min: 1, max: 100 }).withMessage('English name must be between 1 and 100 characters'),
  body('name_ar')
    .trim()
    .notEmpty().withMessage('Arabic name is required')
    .isLength({ min: 1, max: 100 }).withMessage('Arabic name must be between 1 and 100 characters'),
  body('color')
    .notEmpty().withMessage('Color is required')
    .matches(/^#[0-9A-F]{6}$/i).withMessage('Color must be a valid hex color code'),
  body('icon')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Icon must be between 1 and 50 characters'),
  body('order')
    .optional()
    .isInt({ min: 1 }).withMessage('Order must be a positive integer'),
  body('show_in_calendar')
    .optional()
    .isBoolean().withMessage('show_in_calendar must be a boolean'),
  body('is_default')
    .optional()
    .isBoolean().withMessage('is_default must be a boolean'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters')
];

const updateStatusValidation = [
  param('id')
    .notEmpty().withMessage('Status ID is required')
    .isMongoId().withMessage('Invalid status ID'),
  body('name_en')
    .optional()
    .trim()
    .notEmpty().withMessage('English name cannot be empty')
    .isLength({ min: 1, max: 100 }).withMessage('English name must be between 1 and 100 characters'),
  body('name_ar')
    .optional()
    .trim()
    .notEmpty().withMessage('Arabic name cannot be empty')
    .isLength({ min: 1, max: 100 }).withMessage('Arabic name must be between 1 and 100 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-F]{6}$/i).withMessage('Color must be a valid hex color code'),
  body('icon')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Icon must be between 1 and 50 characters'),
  body('order')
    .optional()
    .isInt({ min: 1 }).withMessage('Order must be a positive integer'),
  body('show_in_calendar')
    .optional()
    .isBoolean().withMessage('show_in_calendar must be a boolean'),
  body('is_default')
    .optional()
    .isBoolean().withMessage('is_default must be a boolean'),
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active must be a boolean'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters')
];

const batchUpdateValidation = [
  body('updates')
    .isArray().withMessage('Updates must be an array')
    .notEmpty().withMessage('Updates array cannot be empty'),
  body('updates.*.id')
    .notEmpty().withMessage('Status ID is required')
    .isMongoId().withMessage('Invalid status ID'),
  body('updates.*.order')
    .optional()
    .isInt({ min: 1 }).withMessage('Order must be a positive integer'),
  body('updates.*.is_active')
    .optional()
    .isBoolean().withMessage('is_active must be a boolean'),
  body('updates.*.show_in_calendar')
    .optional()
    .isBoolean().withMessage('show_in_calendar must be a boolean')
];

// Routes
router.get('/', AppointmentStatusController.getStatuses);
router.get('/:id', param('id').isMongoId(), handleValidationErrors, AppointmentStatusController.getStatusById);
router.post('/', createStatusValidation, handleValidationErrors, AppointmentStatusController.createStatus);
router.put('/:id', updateStatusValidation, handleValidationErrors, AppointmentStatusController.updateStatus);
router.delete('/:id', param('id').isMongoId(), handleValidationErrors, AppointmentStatusController.deleteStatus);
router.post('/batch', batchUpdateValidation, handleValidationErrors, AppointmentStatusController.batchUpdate);

export default router;

