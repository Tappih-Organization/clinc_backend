import { Router } from 'express';
import { body } from 'express-validator';
import { DepartmentController } from '../controllers';
import { authenticate } from '../middleware/auth';
import { clinicContext } from '../middleware/clinicContext';

const router = Router();

// Apply authentication middleware first, then clinic context to all routes
router.use(authenticate);
router.use(clinicContext);

// Validation middleware
const departmentValidation = [
  body('code')
    .optional()
    .isLength({ max: 10 })
    .withMessage('Department code cannot exceed 10 characters')
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Department code must contain only uppercase letters and numbers'),
  body('name')
    .notEmpty()
    .withMessage('Department name is required')
    .isLength({ max: 100 })
    .withMessage('Department name cannot exceed 100 characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('head')
    .optional()
    .isMongoId()
    .withMessage('Department head must be a valid user ID'),
  body('location')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Location cannot exceed 200 characters'),
  body('phone')
    .optional()
    .isLength({ max: 20 })
    .withMessage('Phone number cannot exceed 20 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email'),
  body('staffCount')
    .isInt({ min: 0 })
    .withMessage('Staff count must be a non-negative integer'),
  body('budget')
    .isNumeric()
    .withMessage('Budget must be a number')
    .custom((value) => {
      if (parseFloat(value) < 0) {
        throw new Error('Budget cannot be negative');
      }
      return true;
    }),
  body('status')
    .optional()
    .isIn(['active', 'inactive'])
    .withMessage('Status must be either "active" or "inactive"')
];

// Status update validation
const statusValidation = [
  body('status')
    .isIn(['active', 'inactive'])
    .withMessage('Status must be either "active" or "inactive"')
];

// Routes
router.post('/', departmentValidation, DepartmentController.createDepartment);
router.get('/', DepartmentController.getAllDepartments);
router.get('/stats', DepartmentController.getDepartmentStats);
router.get('/:id', DepartmentController.getDepartmentById);
router.put('/:id', departmentValidation, DepartmentController.updateDepartment);
router.patch('/:id/status', statusValidation, DepartmentController.updateDepartmentStatus);
router.delete('/:id', DepartmentController.deleteDepartment);

export default router; 