import { Response } from 'express';
import { validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { Inventory } from '../models';
import { AuthRequest } from '../types/express';
import { getTenantScopedFilter, addTenantToData } from '../middleware/auth';

export class InventoryController {
  static async createInventoryItem(req: AuthRequest, res: Response): Promise<void> {
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

      // Add tenant_id to inventory data with validation
      const { assignedBranches, branchWarehouses, ...restBody } = req.body;
      
      // Process branchWarehouses mapping
      let processedBranchWarehouses: Array<{
        branchId: mongoose.Types.ObjectId;
        warehouseId: mongoose.Types.ObjectId;
      }> = [];
      
      if (branchWarehouses && Array.isArray(branchWarehouses)) {
        processedBranchWarehouses = branchWarehouses.map((bw: any) => ({
          branchId: new mongoose.Types.ObjectId(bw.branchId),
          warehouseId: new mongoose.Types.ObjectId(bw.warehouseId)
        }));
      } else if (assignedBranches && Array.isArray(assignedBranches)) {
        // If branchWarehouses not provided but assignedBranches are, try to find MAIN warehouse for each branch
        const Warehouse = mongoose.model('Warehouse');
        for (const branchId of assignedBranches) {
          const branchObjId = new mongoose.Types.ObjectId(branchId);
          const mainWarehouse = await Warehouse.findOne({
            tenant_id: new mongoose.Types.ObjectId(req.tenant_id!),
            type: 'MAIN',
            assignedBranches: branchObjId,
            deleted_at: null,
            status: 'ACTIVE'
          });
          
          if (mainWarehouse) {
            processedBranchWarehouses.push({
              branchId: branchObjId,
              warehouseId: mainWarehouse._id
            });
          }
        }
      }
      
      // Initialize stockByBranchWarehouse for non-shared warehouses
      const Warehouse = mongoose.model('Warehouse');
      const initialStock = restBody.current_stock || 0;
      const stockByBranchWarehouse: Array<{
        branchId: mongoose.Types.ObjectId;
        warehouseId: mongoose.Types.ObjectId;
        stock: number;
      }> = [];
      let hasSharedWarehouse = false;
      
      // Track which branch/warehouse combinations we've already processed
      const processedCombinations = new Set<string>();
      
      // For each branch/warehouse combination, check if warehouse is shared
      for (const bw of processedBranchWarehouses) {
        const combinationKey = `${bw.branchId.toString()}-${bw.warehouseId.toString()}`;
        if (processedCombinations.has(combinationKey)) {
          continue; // Skip duplicates
        }
        processedCombinations.add(combinationKey);
        
        const warehouse = await Warehouse.findById(bw.warehouseId);
        if (warehouse && !warehouse.isShared) {
          // Non-shared warehouse: each branch/warehouse gets the FULL initial stock
          // Each branch maintains separate stock - they don't share
          // If user enters 100, each branch gets 100 (not distributed)
          stockByBranchWarehouse.push({
            branchId: bw.branchId,
            warehouseId: bw.warehouseId,
            stock: initialStock // Each branch gets full initial stock independently
          });
        } else if (warehouse && warehouse.isShared) {
          hasSharedWarehouse = true;
        }
      }
      
      // For non-shared warehouses: keep current_stock as the original value entered by user
      // Don't recalculate it as sum - it represents the initial stock per branch
      // Each branch/warehouse entry in stockByBranchWarehouse has the full initial stock
      // For shared warehouses: current_stock is the actual shared stock (no change needed)
      
      const inventoryData = addTenantToData(req, {
        ...restBody,
        clinic_id: req.clinic_id,
        tenant_id: req.tenant_id,
        assignedBranches: assignedBranches && Array.isArray(assignedBranches)
          ? assignedBranches.map((id: string) => new mongoose.Types.ObjectId(id))
          : [],
        branchWarehouses: processedBranchWarehouses,
        stockByBranchWarehouse: stockByBranchWarehouse.length > 0 ? stockByBranchWarehouse : undefined
      });

      const inventoryItem = new Inventory(inventoryData);
      await inventoryItem.save();
      
      // Log saved data for debugging
      console.log('✅ Inventory item saved:', {
        id: inventoryItem._id,
        name: inventoryItem.name,
        assignedBranches: inventoryItem.assignedBranches,
        branchWarehouses: inventoryItem.branchWarehouses
      });
      
      // Populate assignedBranches and branchWarehouses for response
      await inventoryItem.populate('assignedBranches', 'name code is_main_clinic parent_clinic_id');
      await inventoryItem.populate('branchWarehouses.branchId', 'name code is_main_clinic parent_clinic_id');
      await inventoryItem.populate('branchWarehouses.warehouseId', 'name type isShared');
      
      // Log populated data for debugging
      console.log('✅ Inventory item populated:', {
        id: inventoryItem._id,
        assignedBranches: inventoryItem.assignedBranches,
        branchWarehouses: inventoryItem.branchWarehouses
      });

      res.status(201).json({
        success: true,
        message: 'Inventory item created successfully',
        data: { inventoryItem }
      });
    } catch (error: any) {
      console.error('Create inventory item error:', error);
      if (error.code === 11000) {
        res.status(409).json({
          success: false,
          message: 'SKU already exists'
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getAllInventoryItems(req: AuthRequest, res: Response): Promise<void> {
    try {
      
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Apply tenant-scoped filtering
      // Show items that are either:
      // 1. Created in the current clinic (clinic_id matches)
      // 2. Assigned to the current clinic (assignedBranches contains current clinic_id)
      const tenantFilter = getTenantScopedFilter(req, {});
      const currentClinicId = new mongoose.Types.ObjectId(req.clinic_id!);
      
      // Base filter: items visible to current clinic
      const clinicVisibilityFilter = {
        $or: [
          { clinic_id: currentClinicId }, // Items created in current clinic
          { assignedBranches: { $in: [currentClinicId] } } // Items assigned to current clinic
        ]
      };
      
      let filter: any = {
        ...tenantFilter,
        ...clinicVisibilityFilter
      };

      if (req.query.category) {
        filter.category = req.query.category;
      }

      if (req.query.status) {
        // Status filter can be 'active', 'inactive', 'low_stock', 'out_of_stock'
        if (req.query.status === 'low_stock') {
          filter.$expr = { $lte: ['$current_stock', '$minimum_stock'] };
        } else if (req.query.status === 'out_of_stock') {
          filter.current_stock = 0;
        }
      }

      if (req.query.low_stock === 'true') {
        filter.$expr = { $lte: ['$current_stock', '$minimum_stock'] };
      }

      // Filter by branchId (assignedBranches) - use $in operator since assignedBranches is an array
      if (req.query.branchId) {
        const branchIdObj = new mongoose.Types.ObjectId(req.query.branchId as string);
        // Filter to show only items assigned to this specific branch
        filter.assignedBranches = { $in: [branchIdObj] };
        // Still respect clinic visibility
        filter.$or = [
          { clinic_id: currentClinicId, assignedBranches: { $in: [branchIdObj] } },
          { assignedBranches: { $in: [branchIdObj] } }
        ];
      }

      if (req.query.search) {
        // Combine search with clinic visibility using $and
        const searchFilter = {
          $or: [
            { name: { $regex: req.query.search, $options: 'i' } },
            { sku: { $regex: req.query.search, $options: 'i' } },
            { supplier: { $regex: req.query.search, $options: 'i' } }
          ]
        };
        
        // If we already have $or for clinic visibility, combine with $and
        if (filter.$or) {
          filter = {
            ...filter,
            $and: [
              { $or: filter.$or },
              searchFilter
            ]
          };
          delete filter.$or;
        } else {
          filter = {
            ...filter,
            ...clinicVisibilityFilter,
            ...searchFilter
          };
        }
      }

      const inventoryItems = await Inventory.find(filter)
        .populate('assignedBranches', 'name code is_main_clinic parent_clinic_id')
        .populate('branchWarehouses.branchId', 'name code is_main_clinic parent_clinic_id')
        .populate('branchWarehouses.warehouseId', 'name type isShared')
        .skip(skip)
        .limit(limit)
        .sort({ created_at: -1 });

      // Filter assignedBranches based on current clinic type
      // Main clinic: show main clinic + all sub clinics
      // Sub clinic: show only current clinic
      const Clinic = mongoose.model('Clinic');
      const currentClinic = await Clinic.findById(currentClinicId);
      
      if (currentClinic) {
        const isMainClinic = currentClinic.is_main_clinic === true;
        
        inventoryItems.forEach((item: any) => {
          if (item.assignedBranches && item.assignedBranches.length > 0) {
            if (isMainClinic) {
              // Main clinic: show main clinic + all sub clinics
              item.assignedBranches = item.assignedBranches.filter((branch: any) => {
                const branchId = branch._id?.toString() || branch._id;
                const branchIsMain = branch.is_main_clinic === true;
                const branchParentId = branch.parent_clinic_id?.toString() || branch.parent_clinic_id;
                
                return branchId === currentClinicId.toString() || 
                       (!branchIsMain && branchParentId === currentClinicId.toString());
              });
            } else {
              // Sub clinic: show only current clinic
              item.assignedBranches = item.assignedBranches.filter((branch: any) => {
                const branchId = branch._id?.toString() || branch._id;
                return branchId === currentClinicId.toString();
              });
            }
          }
        });
      }

      const totalItems = await Inventory.countDocuments(filter);

      res.json({
        success: true,
        data: {
          inventoryItems,
          pagination: {
            page,
            limit,
            total: totalItems,
            pages: Math.ceil(totalItems / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get all inventory items error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getInventoryItemById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const currentClinicId = new mongoose.Types.ObjectId(req.clinic_id!);
      const tenantFilter = getTenantScopedFilter(req, {});
      
      // Find inventory item - check if it's accessible to current clinic
      // Item is accessible if:
      // 1. Created in current clinic (clinic_id matches)
      // 2. Assigned to current clinic (assignedBranches contains current clinic_id)
      const inventoryItem = await Inventory.findOne({
        _id: id,
        ...tenantFilter,
        $or: [
          { clinic_id: currentClinicId },
          { assignedBranches: { $in: [currentClinicId] } }
        ]
      })
        .populate('assignedBranches', 'name code is_main_clinic parent_clinic_id')
        .populate('branchWarehouses.branchId', 'name code is_main_clinic parent_clinic_id')
        .populate('branchWarehouses.warehouseId', 'name type isShared');
      
      // Populate stockByBranchWarehouse references if exists
      if (inventoryItem && inventoryItem.stockByBranchWarehouse && inventoryItem.stockByBranchWarehouse.length > 0) {
        await inventoryItem.populate('stockByBranchWarehouse.branchId', 'name code');
        await inventoryItem.populate('stockByBranchWarehouse.warehouseId', 'name type isShared');
      }

      if (!inventoryItem) {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found or not accessible'
        });
        return;
      }

      // Filter assignedBranches based on current clinic type
      // Main clinic: show main clinic + all sub clinics
      // Sub clinic: show only current clinic
      const Clinic = mongoose.model('Clinic');
      const currentClinic = await Clinic.findById(currentClinicId);
      
      if (currentClinic && inventoryItem.assignedBranches) {
        const isMainClinic = currentClinic.is_main_clinic === true;
        
        if (isMainClinic) {
          // Main clinic: show main clinic + all sub clinics
          inventoryItem.assignedBranches = inventoryItem.assignedBranches.filter((branch: any) => {
            const branchId = branch._id?.toString() || branch._id;
            const branchIsMain = branch.is_main_clinic === true;
            const branchParentId = branch.parent_clinic_id?.toString() || branch.parent_clinic_id;
            
            return branchId === currentClinicId.toString() || 
                   (!branchIsMain && branchParentId === currentClinicId.toString());
          });
        } else {
          // Sub clinic: show only current clinic
          inventoryItem.assignedBranches = inventoryItem.assignedBranches.filter((branch: any) => {
            const branchId = branch._id?.toString() || branch._id;
            return branchId === currentClinicId.toString();
          });
        }
      }

      res.json({
        success: true,
        data: { inventoryItem }
      });
    } catch (error) {
      console.error('Get inventory item by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async updateInventoryItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      // Apply tenant-scoped filtering for inventory update
      const updateFilter = getTenantScopedFilter(req, {
        _id: id,
        clinic_id: req.clinic_id
      });
      
      const { assignedBranches, branchWarehouses, ...restBody } = req.body;
      
      const updateData: any = {
        ...restBody,
        updated_at: new Date()
      };

      if (assignedBranches !== undefined) {
        updateData.assignedBranches = Array.isArray(assignedBranches)
          ? assignedBranches.map((id: string) => new mongoose.Types.ObjectId(id))
          : [];
      }

      if (branchWarehouses !== undefined) {
        if (Array.isArray(branchWarehouses)) {
          updateData.branchWarehouses = branchWarehouses.map((bw: any) => ({
            branchId: new mongoose.Types.ObjectId(bw.branchId),
            warehouseId: new mongoose.Types.ObjectId(bw.warehouseId)
          }));
        } else {
          updateData.branchWarehouses = [];
        }
      }

      const inventoryItem = await Inventory.findOneAndUpdate(
        updateFilter,
        updateData,
        { new: true, runValidators: true }
      )
        .populate('assignedBranches', 'name code')
        .populate('branchWarehouses.branchId', 'name code')
        .populate('branchWarehouses.warehouseId', 'name type');

      if (!inventoryItem) {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Inventory item updated successfully',
        data: { inventoryItem }
      });
    } catch (error) {
      console.error('Update inventory item error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async deleteInventoryItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const inventoryItem = await Inventory.findOneAndDelete({
        _id: id,
        clinic_id: req.clinic_id
      });

      if (!inventoryItem) {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Inventory item deleted successfully'
      });
    } catch (error) {
      console.error('Delete inventory item error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async updateStock(req: AuthRequest, res: Response): Promise<void> {
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

      const { id } = req.params;
      let { quantity, operation, branchId, warehouseId } = req.body;

      // Convert quantity to number if it's a string
      quantity = typeof quantity === 'string' ? parseInt(quantity, 10) : quantity;

      // Validate quantity is a number
      if (isNaN(quantity) || quantity <= 0) {
        res.status(400).json({
          success: false,
          message: 'Quantity must be a positive number'
        });
        return;
      }

      // Find inventory item - check if it's accessible to current clinic
      // Item is accessible if:
      // 1. Created in current clinic (clinic_id matches)
      // 2. Assigned to current clinic (assignedBranches contains current clinic_id)
      const currentClinicId = new mongoose.Types.ObjectId(req.clinic_id!);
      const tenantFilter = getTenantScopedFilter(req, {});
      
      const inventoryItem = await Inventory.findOne({
        _id: id,
        ...tenantFilter,
        $or: [
          { clinic_id: currentClinicId },
          { assignedBranches: { $in: [currentClinicId] } }
        ]
      });

      if (!inventoryItem) {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found or not accessible'
        });
        return;
      }

      // Convert branchId and warehouseId to ObjectIds if provided
      const branchObjId = branchId ? new mongoose.Types.ObjectId(branchId) : undefined;
      const warehouseObjId = warehouseId ? new mongoose.Types.ObjectId(warehouseId) : undefined;

      // Validate quantity for subtraction
      // For non-shared warehouses, check stock in stockByBranchWarehouse
      // For shared warehouses, check current_stock
      if (operation === 'subtract') {
        let availableStock = 0;
        
        if (branchObjId && warehouseObjId) {
          const Warehouse = mongoose.model('Warehouse');
          const warehouse = await Warehouse.findById(warehouseObjId);
          
          if (!warehouse) {
            res.status(400).json({
              success: false,
              message: 'Warehouse not found'
            });
            return;
          }
          
          if (warehouse.isShared) {
            // Shared warehouse: use global current_stock (shared across all branches)
            availableStock = inventoryItem.current_stock || 0;
          } else {
            // Non-shared warehouse: check stock in stockByBranchWarehouse for this specific branch/warehouse
            if (!inventoryItem.stockByBranchWarehouse || inventoryItem.stockByBranchWarehouse.length === 0) {
              // If stockByBranchWarehouse is empty, use current_stock as fallback
              // This handles the case where item was created before the shared warehouse feature
              availableStock = inventoryItem.current_stock || 0;
            } else {
              const stockEntry = inventoryItem.stockByBranchWarehouse.find(
                (entry: any) => 
                  entry.branchId.toString() === branchObjId.toString() &&
                  entry.warehouseId.toString() === warehouseObjId.toString()
              );
              // If entry doesn't exist, this branch/warehouse has 0 stock (not initialized)
              // For backward compatibility, use current_stock only if no entries exist
              if (stockEntry) {
                availableStock = stockEntry.stock || 0;
              } else {
                // Entry doesn't exist - this branch/warehouse hasn't been initialized
                // For backward compatibility with old items, use current_stock
                // But ideally, this should be 0 for new items
                availableStock = inventoryItem.current_stock || 0;
              }
            }
          }
        } else {
          // No branch/warehouse specified: use current_stock
          availableStock = inventoryItem.current_stock || 0;
        }
        
        if (quantity > availableStock) {
          res.status(400).json({
            success: false,
            message: `Cannot subtract more than available stock. Available stock: ${availableStock}`,
            availableStock: availableStock,
            requestedQuantity: quantity
          });
          return;
        }
      }

      await inventoryItem.updateStock(quantity, operation, branchObjId, warehouseObjId);

      // Save the changes (updateStock already marks stockByBranchWarehouse as modified)
      await inventoryItem.save();
      
      // Reload the item from database to ensure we have the latest data
      const updatedItem = await Inventory.findById(inventoryItem._id);
      if (!updatedItem) {
        res.status(404).json({
          success: false,
          message: 'Inventory item not found after update'
        });
        return;
      }
      
      await updatedItem.populate('assignedBranches', 'name code is_main_clinic parent_clinic_id');
      await updatedItem.populate('branchWarehouses.branchId', 'name code is_main_clinic parent_clinic_id');
      await updatedItem.populate('branchWarehouses.warehouseId', 'name type isShared');
      // Populate stockByBranchWarehouse references
      if (updatedItem.stockByBranchWarehouse && updatedItem.stockByBranchWarehouse.length > 0) {
        await updatedItem.populate('stockByBranchWarehouse.branchId', 'name code');
        await updatedItem.populate('stockByBranchWarehouse.warehouseId', 'name type isShared');
      }

      res.json({
        success: true,
        message: 'Stock updated successfully',
        data: { inventoryItem: updatedItem }
      });
    } catch (error: any) {
      console.error('Update stock error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  static async getLowStockItems(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Apply tenant-scoped filtering for low stock items
      const lowStockFilter = getTenantScopedFilter(req, {
        clinic_id: req.clinic_id,
        $expr: { $lte: ['$current_stock', '$minimum_stock'] }
      });
      
      const inventoryItems = await Inventory.find(lowStockFilter)
        .sort({ current_stock: -1 });

      res.json({
        success: true,
        data: { inventoryItems }
      });
    } catch (error) {
      console.error('Get low stock items error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getExpiredItems(req: AuthRequest, res: Response): Promise<void> {
    try {
      const inventoryItems = await Inventory.find({
        clinic_id: req.clinic_id,
        expiry_date: { $lte: new Date() }
      }).sort({ expiry_date: -1 });

      res.json({
        success: true,
        data: { inventoryItems }
      });
    } catch (error) {
      console.error('Get expired items error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getExpiringItems(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const futureDate = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
      
      const inventoryItems = await Inventory.find({
        clinic_id: req.clinic_id,
        expiry_date: { 
          $gte: new Date(),
          $lte: futureDate 
        }
      }).sort({ expiry_date: -1 });

      res.json({
        success: true,
        data: { inventoryItems }
      });
    } catch (error) {
      console.error('Get expiring items error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getInventoryStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Apply tenant-scoped filtering for inventory stats
      const clinicFilter = getTenantScopedFilter(req, {
        clinic_id: req.clinic_id
      });
      const totalItems = await Inventory.countDocuments(clinicFilter);
      const lowStockItems = await Inventory.countDocuments({
        ...clinicFilter,
        $expr: { $lte: ['$current_stock', '$minimum_stock'] }
      });
      const outOfStockItems = await Inventory.countDocuments({ 
        ...clinicFilter,
        current_stock: 0 
      });
      const expiredItems = await Inventory.countDocuments({
        ...clinicFilter,
        expiry_date: { $lte: new Date() }
      });

      const totalValue = await Inventory.aggregate([
        { $match: clinicFilter },
        {
          $group: {
            _id: null,
            total: { $sum: { $multiply: ['$current_stock', '$unit_price'] } }
          }
        }
      ]);

      const categoryStats = await Inventory.aggregate([
        { $match: clinicFilter },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            totalValue: { $sum: { $multiply: ['$current_stock', '$unit_price'] } }
          }
        },
        { $sort: { count: -1 } }
      ]);

      res.json({
        success: true,
        data: {
          totalItems,
          lowStockItems,
          outOfStockItems,
          expiredItems,
          totalValue: totalValue[0]?.total || 0,
          categoryStats
        }
      });
    } catch (error) {
      console.error('Get inventory stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
} 