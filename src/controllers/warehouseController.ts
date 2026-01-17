import { Response } from 'express';
import { validationResult } from 'express-validator';
import mongoose, { Types } from 'mongoose';
import { Warehouse, Clinic, Inventory } from '../models';
import { AuthRequest } from '../types/express';
import { getTenantScopedFilter, addTenantToData } from '../middleware/auth';
import { emitWarehouseEvent } from '../utils/warehouseEvents';

export class WarehouseController {
  /**
   * Get all warehouses with filters, search, pagination, and sorting
   * GET /api/warehouses
   */
  static async getAllWarehouses(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Build filter with tenant scope
      let filter: any = getTenantScopedFilter(req, {
        deleted_at: null // Only non-deleted warehouses
      });

      // Filter by clinic context - only show warehouses assigned to the current clinic
      // This ensures users only see warehouses for their current clinic context
      if (req.clinic_id) {
        filter.assignedBranches = new Types.ObjectId(req.clinic_id);
      }

      // Search by warehouse name
      if (req.query.search) {
        filter.name = { $regex: req.query.search, $options: 'i' };
      }

      // Filter by type
      if (req.query.type && (req.query.type === 'MAIN' || req.query.type === 'SUB')) {
        filter.type = req.query.type;
      }

      // Filter by status
      if (req.query.status && (req.query.status === 'ACTIVE' || req.query.status === 'INACTIVE')) {
        filter.status = req.query.status;
      }

      // Filter by branchId (overrides clinic context if explicitly provided)
      if (req.query.branchId) {
        filter.assignedBranches = new Types.ObjectId(req.query.branchId as string);
      }

      // Sorting
      const sortBy = (req.query.sortBy as string) || 'created_at';
      const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1;
      const sort: any = {};
      sort[sortBy] = sortOrder;

      // Execute query with population
      const warehouses = await Warehouse.find(filter)
        .populate('assignedBranches', 'name code')
        .populate('managerUserId', 'fullName email role')
        .skip(skip)
        .limit(limit)
        .sort(sort);

      const total = await Warehouse.countDocuments(filter);

      // Get item count for each warehouse
      // Count items that have this warehouse in their branchWarehouses array
      const warehousesWithCount = await Promise.all(
        warehouses.map(async (warehouse) => {
          const warehouseId = warehouse._id;
          
          // Count items that reference this warehouse in branchWarehouses
          const itemCount = await Inventory.countDocuments({
            ...getTenantScopedFilter(req, {}),
            'branchWarehouses.warehouseId': warehouseId
          });

          // Convert warehouse to plain object and add itemCount
          const warehouseObj = warehouse.toObject();
          return {
            ...warehouseObj,
            itemCount
          };
        })
      );

      res.json({
        success: true,
        data: warehousesWithCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error: any) {
      console.error('Get all warehouses error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching warehouses'
      });
    }
  }

  /**
   * Get warehouse by ID
   * GET /api/warehouses/:id
   */
  static async getWarehouseById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const filter = getTenantScopedFilter(req, {
        _id: id,
        deleted_at: null
      });

      const warehouse = await Warehouse.findOne(filter)
        .populate('assignedBranches', 'name code')
        .populate('managerUserId', 'fullName email role');

      if (!warehouse) {
        res.status(404).json({
          success: false,
          message: 'Warehouse not found'
        });
        return;
      }

      res.json({
        success: true,
        data: warehouse
      });
    } catch (error: any) {
      console.error('Get warehouse by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching warehouse'
      });
    }
  }

  /**
   * Create new warehouse
   * POST /api/warehouses
   */
  static async createWarehouse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
        return;
      }

      const { name, type, assignedBranches, managerUserId, status, isShared } = req.body;

      // Log incoming data for debugging
      console.log('📦 Creating warehouse with data:', {
        name,
        type,
        assignedBranches,
        assignedBranchesCount: assignedBranches?.length || 0,
        managerUserId,
        status
      });

      // Validate assigned branches exist and belong to tenant
      if (!assignedBranches || !Array.isArray(assignedBranches) || assignedBranches.length === 0) {
        res.status(400).json({
          success: false,
          message: 'At least one branch must be assigned'
        });
        return;
      }

      // Start transaction after validation
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Verify all branches exist and belong to tenant
        const tenantFilter = getTenantScopedFilter(req, {});
        
        // Convert assignedBranches to ObjectIds and remove duplicates
        const uniqueBranchIds = [...new Set(assignedBranches)].map((id: string) => new Types.ObjectId(id));
        
        const branches = await Clinic.find({
          ...tenantFilter,
          _id: { $in: uniqueBranchIds }
        }).session(session);

        // Validate that all requested branches were found and belong to tenant
        if (branches.length !== uniqueBranchIds.length) {
          await session.abortTransaction();
          res.status(400).json({
            success: false,
            message: 'One or more branches not found or do not belong to your tenant'
          });
          return;
        }

        // Validate that no duplicate branch IDs were sent
        if (assignedBranches.length !== uniqueBranchIds.length) {
          await session.abortTransaction();
          res.status(400).json({
            success: false,
            message: 'Duplicate branch IDs detected in assigned branches'
          });
          return;
        }

        // Use only the validated unique branch IDs (no automatic additions)
        const validatedBranchIds = uniqueBranchIds;

        // Log validated branches for debugging
        console.log('✅ Validated branch IDs:', {
          originalCount: assignedBranches.length,
          uniqueCount: validatedBranchIds.length,
          branchIds: validatedBranchIds.map(id => id.toString())
        });

        // Validate MAIN warehouse constraint: Each branch can have exactly ONE MAIN warehouse
        // Use validatedBranchIds to ensure we only check the branches that will actually be assigned
        if (type === 'MAIN' && req.tenant_id) {
          for (const branchId of validatedBranchIds) {
            const existingMain = await Warehouse.findOne({
              tenant_id: new Types.ObjectId(req.tenant_id),
              type: 'MAIN',
              assignedBranches: branchId, // branchId is already ObjectId from validatedBranchIds
              deleted_at: null
            }).session(session);

            if (existingMain) {
              await session.abortTransaction();
              res.status(400).json({
                success: false,
                message: `Branch ${branchId} already has a MAIN warehouse. Each branch can have exactly ONE MAIN warehouse.`
              });
              return;
            }
          }
        }

        // Create warehouse with ONLY the validated branch IDs (no automatic additions)
        const warehouseData = addTenantToData(req, {
          name,
          type,
          status: status || 'ACTIVE',
          assignedBranches: validatedBranchIds, // Use validated unique branch IDs only
          managerUserId: managerUserId ? new Types.ObjectId(managerUserId) : undefined,
          isShared: isShared === true || isShared === 'true' ? true : false
        });

        // Log warehouse data before saving
        console.log('💾 Saving warehouse with assignedBranches:', {
          warehouseName: warehouseData.name,
          warehouseType: warehouseData.type,
          assignedBranchesCount: warehouseData.assignedBranches.length,
          assignedBranches: warehouseData.assignedBranches.map(id => id.toString())
        });

        const warehouse = new Warehouse(warehouseData);
        await warehouse.save({ session });

        // Log saved warehouse data
        console.log('✅ Warehouse saved successfully:', {
          warehouseId: warehouse._id.toString(),
          assignedBranchesCount: warehouse.assignedBranches.length,
          assignedBranches: warehouse.assignedBranches.map(id => id.toString())
        });

        await session.commitTransaction();

        // Populate and return
        const createdWarehouse = await Warehouse.findById(warehouse._id)
          .populate('assignedBranches', 'name code')
          .populate('managerUserId', 'fullName email role');

        if (!createdWarehouse) {
          await session.abortTransaction();
          res.status(500).json({
            success: false,
            message: 'Error creating warehouse'
          });
          return;
        }

        // Emit real-time event
        if (req.tenant_id) {
          emitWarehouseEvent('warehouse.created', createdWarehouse, req.tenant_id.toString());
        }

        res.status(201).json({
          success: true,
          message: 'Warehouse created successfully',
          data: createdWarehouse
        });
      } catch (error: any) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } catch (error: any) {
      console.error('Create warehouse error:', error);
      
      if (error.message && error.message.includes('already has a MAIN warehouse')) {
        res.status(400).json({
          success: false,
          message: error.message
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Error creating warehouse'
      });
    }
  }

  /**
   * Update warehouse
   * PUT /api/warehouses/:id
   */
  static async updateWarehouse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, type, assignedBranches, managerUserId, status, isShared } = req.body;

      const filter = getTenantScopedFilter(req, {
        _id: id,
        deleted_at: null
      });

      // Start transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const warehouse = await Warehouse.findOne(filter).session(session);

        if (!warehouse) {
          await session.abortTransaction();
          res.status(404).json({
            success: false,
            message: 'Warehouse not found'
          });
          return;
        }

        // Validate assigned branches if provided
        let validatedBranchIds: Types.ObjectId[] | undefined = undefined;
        
        if (assignedBranches && Array.isArray(assignedBranches) && assignedBranches.length > 0) {
          const tenantFilter = getTenantScopedFilter(req, {});
          
          // Convert assignedBranches to ObjectIds and remove duplicates
          const uniqueBranchIds = [...new Set(assignedBranches)].map((id: string) => new Types.ObjectId(id));
          
          const branches = await Clinic.find({
            ...tenantFilter,
            _id: { $in: uniqueBranchIds }
          }).session(session);

          // Validate that all requested branches were found and belong to tenant
          if (branches.length !== uniqueBranchIds.length) {
            await session.abortTransaction();
            res.status(400).json({
              success: false,
              message: 'One or more branches not found or do not belong to your tenant'
            });
            return;
          }

          // Validate that no duplicate branch IDs were sent
          if (assignedBranches.length !== uniqueBranchIds.length) {
            await session.abortTransaction();
            res.status(400).json({
              success: false,
              message: 'Duplicate branch IDs detected in assigned branches'
            });
            return;
          }

          // Use only the validated unique branch IDs (no automatic additions)
          validatedBranchIds = uniqueBranchIds;

          // Validate MAIN warehouse constraint if type is MAIN
          if ((type === 'MAIN' || (!type && warehouse.type === 'MAIN')) && req.tenant_id) {
            const finalType = type || warehouse.type;
            for (const branchId of validatedBranchIds) {
              const existingMain = await Warehouse.findOne({
                tenant_id: new Types.ObjectId(req.tenant_id),
                type: 'MAIN',
                assignedBranches: new Types.ObjectId(branchId),
                deleted_at: null,
                _id: { $ne: id } // Exclude current warehouse
              }).session(session);

              if (existingMain) {
                await session.abortTransaction();
                res.status(400).json({
                  success: false,
                  message: `Branch ${branchId} already has a MAIN warehouse. Each branch can have exactly ONE MAIN warehouse.`
                });
                return;
              }
            }
          }
        }

        // Update fields
        if (name !== undefined) warehouse.name = name;
        if (type !== undefined) warehouse.type = type;
        if (status !== undefined) warehouse.status = status;
        if (isShared !== undefined) warehouse.isShared = isShared === true || isShared === 'true' ? true : false;
        if (assignedBranches !== undefined && validatedBranchIds !== undefined) {
          // Use validated unique branch IDs only (no automatic additions)
          warehouse.assignedBranches = validatedBranchIds;
        }
        if (managerUserId !== undefined) {
          warehouse.managerUserId = managerUserId ? new Types.ObjectId(managerUserId) : undefined;
        }

        await warehouse.save({ session });
        await session.commitTransaction();

        // Populate and return
        const updatedWarehouse = await Warehouse.findById(warehouse._id)
          .populate('assignedBranches', 'name code')
          .populate('managerUserId', 'fullName email role');

        if (!updatedWarehouse) {
          await session.abortTransaction();
          res.status(500).json({
            success: false,
            message: 'Error updating warehouse'
          });
          return;
        }

        // Emit real-time event
        if (req.tenant_id) {
          emitWarehouseEvent('warehouse.updated', updatedWarehouse, req.tenant_id.toString());
        }

        res.json({
          success: true,
          message: 'Warehouse updated successfully',
          data: updatedWarehouse
        });
      } catch (error: any) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } catch (error: any) {
      console.error('Update warehouse error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating warehouse'
      });
    }
  }

  /**
   * Update warehouse status
   * PATCH /api/warehouses/:id/status
   */
  static async updateWarehouseStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || (status !== 'ACTIVE' && status !== 'INACTIVE')) {
        res.status(400).json({
          success: false,
          message: 'Status must be ACTIVE or INACTIVE'
        });
        return;
      }

      const filter = getTenantScopedFilter(req, {
        _id: id,
        deleted_at: null
      });

      const warehouse = await Warehouse.findOneAndUpdate(
        filter,
        { status },
        { new: true }
      )
        .populate('assignedBranches', 'name code')
        .populate('managerUserId', 'fullName email role');

      if (!warehouse) {
        res.status(404).json({
          success: false,
          message: 'Warehouse not found'
        });
        return;
      }

      // Emit real-time event
      if (req.tenant_id) {
        emitWarehouseEvent('warehouse.statusChanged', warehouse, req.tenant_id.toString());
      }

      res.json({
        success: true,
        message: 'Warehouse status updated successfully',
        data: warehouse
      });
    } catch (error: any) {
      console.error('Update warehouse status error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating warehouse status'
      });
    }
  }

  /**
   * Get warehouse items
   * GET /api/warehouses/:id/items
   */
  static async getWarehouseItems(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 1000; // Large limit for exporting all items
      const skip = (page - 1) * limit;

      // Verify warehouse exists and belongs to tenant
      const warehouseFilter = getTenantScopedFilter(req, {
        _id: id,
        deleted_at: null
      });

      const warehouse = await Warehouse.findOne(warehouseFilter);

      if (!warehouse) {
        res.status(404).json({
          success: false,
          message: 'Warehouse not found'
        });
        return;
      }

      // Build filter for items in this warehouse
      const tenantFilter = getTenantScopedFilter(req, {});
      const warehouseId = new Types.ObjectId(id);

      // Find items that have this warehouse in their branchWarehouses array
      const filter: any = {
        ...tenantFilter,
        'branchWarehouses.warehouseId': warehouseId
      };

      // Optional search filter
      if (req.query.search) {
        filter.$and = [
          { $or: [
            { name: { $regex: req.query.search, $options: 'i' } },
            { sku: { $regex: req.query.search, $options: 'i' } },
            { supplier: { $regex: req.query.search, $options: 'i' } }
          ]}
        ];
      }

      // Get items
      const items = await Inventory.find(filter)
        .populate('assignedBranches', 'name code')
        .populate('branchWarehouses.branchId', 'name code')
        .populate('branchWarehouses.warehouseId', 'name type')
        .skip(skip)
        .limit(limit)
        .sort({ created_at: -1 });

      const total = await Inventory.countDocuments(filter);

      res.json({
        success: true,
        data: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error: any) {
      console.error('Get warehouse items error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching warehouse items'
      });
    }
  }

  /**
   * Delete warehouse (soft delete)
   * DELETE /api/warehouses/:id
   */
  static async deleteWarehouse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const filter = getTenantScopedFilter(req, {
        _id: id,
        deleted_at: null
      });

      const warehouse = await Warehouse.findOne(filter);

      if (!warehouse) {
        res.status(404).json({
          success: false,
          message: 'Warehouse not found'
        });
        return;
      }

      // Check if there are any items in this warehouse
      const tenantFilter = getTenantScopedFilter(req, {});
      const warehouseId = new Types.ObjectId(id);

      // Check for items assigned to this warehouse
      const itemsWithWarehouse = await Inventory.countDocuments({
        ...tenantFilter,
        $or: [
          { 'branchWarehouses.warehouseId': warehouseId },
          { 'stockByBranchWarehouse.warehouseId': warehouseId }
        ]
      });

      if (itemsWithWarehouse > 0) {
        res.status(400).json({
          success: false,
          message: 'Cannot delete warehouse. There are items assigned to this warehouse. Please remove or reassign all items before deleting.'
        });
        return;
      }

      // Soft delete
      warehouse.deleted_at = new Date();
      warehouse.status = 'INACTIVE';
      await warehouse.save();

      // Emit real-time event
      if (req.tenant_id) {
        emitWarehouseEvent('warehouse.deleted', warehouse, req.tenant_id.toString());
      }

      res.json({
        success: true,
        message: 'Warehouse deleted successfully'
      });
    } catch (error: any) {
      console.error('Delete warehouse error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting warehouse'
      });
    }
  }
}
