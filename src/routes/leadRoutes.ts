import { Router } from 'express';
import { body } from 'express-validator';
import { LeadController } from '../controllers';
import { authenticate, requireStaff } from '../middleware/auth';
import { clinicContext } from '../middleware/clinicContext';

const router = Router();

// Validation middleware for creating/updating leads
const leadValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').optional({ checkFalsy: true }).trim().isString().withMessage('Last name must be a string'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('source').isIn(['website', 'referral', 'social', 'advertisement', 'walk-in'])
    .withMessage('Invalid source. Must be one of: website, referral, social, advertisement, walk-in'),
  body('serviceInterest').notEmpty().withMessage('Service interest is required'),
  body('status').optional().isIn(['new', 'contacted', 'converted', 'lost'])
    .withMessage('Invalid status. Must be one of: new, contacted, converted, lost'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Please provide a valid email'),
  body('assignedTo').optional({ checkFalsy: true }).isString().withMessage('Assigned to must be a string'),
  body('notes').optional({ checkFalsy: true }).isString().withMessage('Notes must be a string')
];

// Validation for lead to patient conversion
const conversionValidation = [
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').optional({ checkFalsy: true }).trim().isString().withMessage('Last name must be a string'),
  body('date_of_birth').optional({ checkFalsy: true }).isISO8601().withMessage('Please provide a valid date of birth').toDate(),
  body('gender').optional().isIn(['male', 'female']).withMessage('Invalid gender. Must be male or female'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Please provide a valid email'),
  body('address').optional({ checkFalsy: true }).trim().isString().withMessage('Address must be a string'),
  body('emergency_contact.name').optional({ checkFalsy: true }).trim().isString().withMessage('Emergency contact name must be a string'),
  body('emergency_contact.relationship').optional({ checkFalsy: true }).trim().isString().withMessage('Emergency contact relationship must be a string'),
  body('emergency_contact.phone').optional({ checkFalsy: true }).trim().isString().withMessage('Emergency contact phone must be a string'),
  body('emergency_contact.email').optional({ checkFalsy: true }).isEmail().withMessage('Please provide a valid emergency contact email'),
  body('insurance_info.provider').optional({ checkFalsy: true }).trim().isString().withMessage('Insurance provider must be a string'),
  body('insurance_info.policy_number').optional({ checkFalsy: true }).trim().isString().withMessage('Policy number must be a string'),
  body('insurance_info.group_number').optional({ checkFalsy: true }).trim().isString().withMessage('Group number must be a string')
];

// Basic CRUD routes (require authentication and clinic context)
router.post('/', authenticate, clinicContext, leadValidation, LeadController.createLead);
router.get('/', authenticate, clinicContext, LeadController.getAllLeads);
router.get('/stats', authenticate, clinicContext, LeadController.getLeadStats);
router.get('/assignee/:assignee', authenticate, clinicContext, LeadController.getLeadsByAssignee);
router.get('/:id', authenticate, clinicContext, LeadController.getLeadById);
router.put('/:id', authenticate, clinicContext, leadValidation, LeadController.updateLead);
router.delete('/:id', authenticate, clinicContext, ...requireStaff, LeadController.deleteLead);

// Special endpoints
router.patch('/:id/status', authenticate, clinicContext, LeadController.updateLeadStatus);
router.post('/:id/convert', authenticate, clinicContext, conversionValidation, LeadController.convertLeadToPatient);

export default router; 