import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { WarehouseController } from '../controllers/warehouseController';
import { authenticate } from '../middleware/auth';
import { clinicContext } from '../middleware/clinicContext';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(clinicContext);

// Validation middleware
const createWarehouseValidation = [
  body('name').notEmpty().withMessage('Warehouse name is required'),
  body('type').isIn(['MAIN', 'SUB']).withMessage('Type must be MAIN or SUB'),
  body('assignedBranches').isArray({ min: 1 }).withMessage('At least one branch must be assigned'),
  body('assignedBranches.*').isMongoId().withMessage('Invalid branch ID'),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE']).withMessage('Status must be ACTIVE or INACTIVE'),
  body('managerUserId').optional().isMongoId().withMessage('Invalid manager user ID'),
  body('isShared').optional().isBoolean().withMessage('isShared must be a boolean')
];

const updateWarehouseValidation = [
  body('name').optional().notEmpty().withMessage('Warehouse name cannot be empty'),
  body('type').optional().isIn(['MAIN', 'SUB']).withMessage('Type must be MAIN or SUB'),
  body('assignedBranches').optional().isArray({ min: 1 }).withMessage('At least one branch must be assigned'),
  body('assignedBranches.*').optional().isMongoId().withMessage('Invalid branch ID'),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE']).withMessage('Status must be ACTIVE or INACTIVE'),
  body('managerUserId').optional().isMongoId().withMessage('Invalid manager user ID'),
  body('isShared').optional().isBoolean().withMessage('isShared must be a boolean')
];

const updateStatusValidation = [
  body('status').isIn(['ACTIVE', 'INACTIVE']).withMessage('Status must be ACTIVE or INACTIVE')
];

// Routes
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('search').optional().isString().withMessage('Search must be a string'),
    query('type').optional().isIn(['MAIN', 'SUB']).withMessage('Type must be MAIN or SUB'),
    query('status').optional().isIn(['ACTIVE', 'INACTIVE']).withMessage('Status must be ACTIVE or INACTIVE'),
    query('branchId').optional().isMongoId().withMessage('Invalid branch ID'),
    query('sortBy').optional().isString().withMessage('SortBy must be a string'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('SortOrder must be asc or desc')
  ],
  WarehouseController.getAllWarehouses
);

router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid warehouse ID')],
  WarehouseController.getWarehouseById
);

router.post(
  '/',
  createWarehouseValidation,
  WarehouseController.createWarehouse
);

router.put(
  '/:id',
  [
    param('id').isMongoId().withMessage('Invalid warehouse ID'),
    ...updateWarehouseValidation
  ],
  WarehouseController.updateWarehouse
);

router.patch(
  '/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid warehouse ID'),
    ...updateStatusValidation
  ],
  WarehouseController.updateWarehouseStatus
);

router.get(
  '/:id/items',
  [
    param('id').isMongoId().withMessage('Invalid warehouse ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 10000 }).withMessage('Limit must be between 1 and 10000'),
    query('search').optional().isString().withMessage('Search must be a string')
  ],
  WarehouseController.getWarehouseItems
);

router.delete(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid warehouse ID')],
  WarehouseController.deleteWarehouse
);

export default router;
