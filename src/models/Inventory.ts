import mongoose, { Document, Schema } from 'mongoose';

export interface IInventory extends Document {
  tenant_id: mongoose.Types.ObjectId;
  clinic_id: mongoose.Types.ObjectId;
  name: string;
  category: string;
  sku: string;
  current_stock: number;
  minimum_stock: number;
  unit_price: number;
  supplier: string;
  expiry_date?: Date;
  assignedBranches?: mongoose.Types.ObjectId[]; // Many-to-Many with Clinic (branches)
  branchWarehouses?: Array<{
    branchId: mongoose.Types.ObjectId;
    warehouseId: mongoose.Types.ObjectId;
  }>; // Mapping between branches and their warehouses
  stockByBranchWarehouse?: Array<{
    branchId: mongoose.Types.ObjectId;
    warehouseId: mongoose.Types.ObjectId;
    stock: number;
  }>; // Stock quantity per branch/warehouse combination (for non-shared warehouses)
  created_at: Date;
  updated_at: Date;
  getTotalValue(): number;
  updateStock(quantity: number, operation?: 'add' | 'subtract', branchId?: mongoose.Types.ObjectId, warehouseId?: mongoose.Types.ObjectId): Promise<IInventory>;
}

export interface IInventoryModel extends mongoose.Model<IInventory> {
  findLowStock(): mongoose.Query<IInventory[], IInventory>;
  findExpired(): mongoose.Query<IInventory[], IInventory>;
  findExpiringWithinDays(days?: number): mongoose.Query<IInventory[], IInventory>;
}

const InventorySchema: Schema = new Schema({
  tenant_id: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required']
  },
  clinic_id: {
    type: Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    maxlength: [255, 'Item name cannot exceed 255 characters']
  },
  category: {
    type: String,
    required: [true, 'Item category is required'],
    trim: true,
    maxlength: [100, 'Category cannot exceed 100 characters'],
    enum: [
      'medications',
      'medical-devices',
      'consumables',
      'equipment',
      'laboratory',
      'office-supplies',
      'other'
    ]
  },
  sku: {
    type: String,
    required: [true, 'SKU is required'],
    trim: true,
    uppercase: true,
    maxlength: [50, 'SKU cannot exceed 50 characters'],
    match: [/^[A-Z0-9-_]+$/, 'SKU can only contain uppercase letters, numbers, hyphens, and underscores']
  },
  current_stock: {
    type: Number,
    required: [true, 'Current stock is required'],
    min: [0, 'Current stock cannot be negative'],
    default: 0
  },
  minimum_stock: {
    type: Number,
    required: [true, 'Minimum stock threshold is required'],
    min: [0, 'Minimum stock cannot be negative'],
    default: 1
  },
  unit_price: {
    type: Number,
    required: [true, 'Unit price is required'],
    min: [0, 'Unit price cannot be negative'],
    validate: {
      validator: function(value: number) {
        return Number.isFinite(value) && value >= 0;
      },
      message: 'Unit price must be a valid positive number'
    }
  },
  supplier: {
    type: String,
    required: [true, 'Supplier information is required'],
    trim: true,
    maxlength: [255, 'Supplier information cannot exceed 255 characters']
  },
  expiry_date: {
    type: Date,
    validate: {
      validator: function(value: Date) {
        return !value || value > new Date();
      },
      message: 'Expiry date must be in the future'
    }
  },
  assignedBranches: [{
    type: Schema.Types.ObjectId,
    ref: 'Clinic',
    required: false
  }],
  branchWarehouses: [{
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true
    }
  }],
  stockByBranchWarehouse: [{
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    }
  }]
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Create tenant-aware indexes for better query performance
InventorySchema.index({ tenant_id: 1 });
InventorySchema.index({ tenant_id: 1, clinic_id: 1 });
InventorySchema.index({ tenant_id: 1, clinic_id: 1, sku: 1 }, { unique: true }); // Unique SKU per clinic
InventorySchema.index({ tenant_id: 1, clinic_id: 1, category: 1 });
InventorySchema.index({ tenant_id: 1, clinic_id: 1, current_stock: 1 });
InventorySchema.index({ tenant_id: 1, clinic_id: 1, expiry_date: 1 });
InventorySchema.index({ tenant_id: 1, assignedBranches: 1 }); // For branch filtering
InventorySchema.index({ assignedBranches: 1 }); // For branch queries
InventorySchema.index({ 
  tenant_id: 1,
  clinic_id: 1,
  name: 'text', 
  category: 'text', 
  supplier: 'text' 
}); // Text search within tenant/clinic

// Virtual to check if item is low in stock
InventorySchema.virtual('is_low_stock').get(function() {
  return (this.current_stock as number) <= (this.minimum_stock as number);
});

// Virtual to check if item is out of stock
InventorySchema.virtual('is_out_of_stock').get(function() {
  return this.current_stock === 0;
});

// Virtual to check if item is expired or expiring soon
InventorySchema.virtual('expiry_status').get(function() {
  if (!this.expiry_date) return 'no-expiry';
  
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
  
  if (this.expiry_date <= now) return 'expired';
  if (this.expiry_date <= thirtyDaysFromNow) return 'expiring-soon';
  return 'valid';
});

// Method to calculate total value of current stock
InventorySchema.methods.getTotalValue = function() {
  return this.current_stock * this.unit_price;
};

// Method to update stock (add or subtract)
// For shared warehouses: updates current_stock (affects all branches)
// For non-shared warehouses: updates stockByBranchWarehouse for specific branch/warehouse
InventorySchema.methods.updateStock = async function(
  quantity: number, 
  operation: 'add' | 'subtract' = 'add',
  branchId?: mongoose.Types.ObjectId,
  warehouseId?: mongoose.Types.ObjectId
) {
  const Warehouse = mongoose.model('Warehouse');
  
  // If branchId and warehouseId are provided, check if warehouse is shared
  if (branchId && warehouseId) {
    const warehouse = await Warehouse.findById(warehouseId);
    
    if (!warehouse) {
      // Warehouse not found - fallback to global update
      if (operation === 'add') {
        this.current_stock += Math.abs(quantity);
      } else {
        this.current_stock = Math.max(0, this.current_stock - Math.abs(quantity));
      }
      return this.save();
    }
    
    if (warehouse.isShared) {
      // Shared warehouse: update global current_stock (affects all branches using this warehouse)
      if (operation === 'add') {
        this.current_stock += Math.abs(quantity);
      } else {
        this.current_stock = Math.max(0, this.current_stock - Math.abs(quantity));
      }
    } else {
        // Non-shared warehouse: update stock for specific branch/warehouse combination ONLY
        // Each branch/warehouse maintains separate stock - no sharing
        if (!this.stockByBranchWarehouse) {
          this.stockByBranchWarehouse = [];
        }
        
        const stockEntry = this.stockByBranchWarehouse.find(
          (entry: any) => 
            entry.branchId.toString() === branchId.toString() &&
            entry.warehouseId.toString() === warehouseId.toString()
        );
        
        if (stockEntry) {
          // Update existing entry - only affects this specific branch/warehouse
          if (operation === 'add') {
            stockEntry.stock += Math.abs(quantity);
          } else {
            stockEntry.stock = Math.max(0, stockEntry.stock - Math.abs(quantity));
          }
          // Mark the array as modified so Mongoose saves the changes
          this.markModified('stockByBranchWarehouse');
        } else {
          // Create new entry for this branch/warehouse combination
          // For non-shared warehouses, each branch/warehouse starts with its own stock
          let initialStock = 0;
          if (operation === 'add') {
            // Adding stock: new entry gets the added quantity
            initialStock = Math.abs(quantity);
          } else {
            // Subtracting stock: check if this is the first entry (backward compatibility)
            // or if we need to initialize from current_stock
            if (this.stockByBranchWarehouse.length === 0 && this.current_stock > 0) {
              // First entry and item has stock: use current_stock as base
              initialStock = Math.max(0, (this.current_stock as number) - Math.abs(quantity));
            } else {
              // Additional branch/warehouse or no existing stock: cannot subtract from 0
              // This should have been validated in controller, but set to 0 as safety
              initialStock = 0;
            }
          }
          this.stockByBranchWarehouse.push({
            branchId,
            warehouseId,
            stock: initialStock
          });
          // Mark the array as modified so Mongoose saves the changes
          this.markModified('stockByBranchWarehouse');
        }
        
        // For non-shared warehouses, current_stock should NOT be recalculated as sum
        // Each branch/warehouse maintains separate stock
        // current_stock is only used for backward compatibility and shared warehouses
        // We keep it for display purposes but it doesn't affect individual branch stock
      }
  } else {
    // Fallback: update global current_stock (for backward compatibility)
    if (operation === 'add') {
      this.current_stock += Math.abs(quantity);
    } else {
      this.current_stock = Math.max(0, this.current_stock - Math.abs(quantity));
    }
  }
  
  return this.save();
};

// Static method to find low stock items
InventorySchema.statics.findLowStock = function() {
  return this.find({ $expr: { $lte: ['$current_stock', '$minimum_stock'] } });
};

// Static method to find expired items
InventorySchema.statics.findExpired = function() {
  return this.find({
    expiry_date: { $lte: new Date() }
  });
};

// Static method to find items expiring within specified days
InventorySchema.statics.findExpiringWithinDays = function(days: number = 30) {
  const futureDate = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
  return this.find({
    expiry_date: { 
      $gte: new Date(),
      $lte: futureDate 
    }
  });
};

export default mongoose.model<IInventory, IInventoryModel>('Inventory', InventorySchema); 