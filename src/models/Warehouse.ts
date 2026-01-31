import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IWarehouse extends Document {
  _id: Types.ObjectId;
  tenant_id: Types.ObjectId;
  name: string;
  type: 'MAIN' | 'SUB';
  status: 'ACTIVE' | 'INACTIVE';
  assignedBranches: Types.ObjectId[]; // Many-to-Many with Clinic (branches)
  managerUserId?: Types.ObjectId;
  isShared?: boolean; // If true, inventory deductions/additions affect all branches using this warehouse
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date; // Soft delete
}

const WarehouseSchema: Schema = new Schema({
  tenant_id: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required']
  },
  name: {
    type: String,
    required: [true, 'Warehouse name is required'],
    trim: true,
    maxlength: [200, 'Warehouse name cannot exceed 200 characters'],
    minlength: [2, 'Warehouse name must be at least 2 characters']
  },
  type: {
    type: String,
    enum: ['MAIN', 'SUB'],
    required: [true, 'Warehouse type is required']
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE',
    required: [true, 'Status is required']
  },
  assignedBranches: [{
    type: Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true
  }],
  managerUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  isShared: {
    type: Boolean,
    default: false,
    required: false
  },
  deleted_at: {
    type: Date,
    default: null
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes for better performance
WarehouseSchema.index({ tenant_id: 1 });
WarehouseSchema.index({ tenant_id: 1, type: 1 });
WarehouseSchema.index({ tenant_id: 1, status: 1 });
WarehouseSchema.index({ tenant_id: 1, assignedBranches: 1 });
WarehouseSchema.index({ tenant_id: 1, managerUserId: 1 });
WarehouseSchema.index({ assignedBranches: 1 });
WarehouseSchema.index({ deleted_at: 1 }); // For soft delete queries

// Compound index for unique MAIN warehouse per branch constraint
WarehouseSchema.index(
  { tenant_id: 1, type: 1, assignedBranches: 1 },
  { 
    unique: false, // We'll handle uniqueness in application logic
    partialFilterExpression: { type: 'MAIN', deleted_at: null }
  }
);

// Pre-save middleware to ensure exactly ONE MAIN warehouse per branch
WarehouseSchema.pre<IWarehouse>('save', async function(next) {
  // Only validate for MAIN warehouses that are not deleted
  if (this.type === 'MAIN' && !this.deleted_at) {
    // Check if any assigned branch already has a MAIN warehouse
    const WarehouseModel = mongoose.model<IWarehouse>('Warehouse');
    for (const branchId of this.assignedBranches) {
      const existingMainWarehouse = await WarehouseModel.findOne({
        tenant_id: this.tenant_id,
        type: 'MAIN',
        assignedBranches: branchId,
        deleted_at: null,
        _id: { $ne: this._id } // Exclude current warehouse if updating
      });

      if (existingMainWarehouse) {
        return next(new Error(`Branch ${branchId} already has a MAIN warehouse. Each branch can have exactly ONE MAIN warehouse.`));
      }
    }
  }
  next();
});

// Static method to find warehouses by branch
WarehouseSchema.statics.findByBranch = function(branchId: Types.ObjectId) {
  return this.find({
    assignedBranches: branchId,
    deleted_at: null
  });
};

// Static method to find MAIN warehouse for a branch
WarehouseSchema.statics.findMainWarehouseForBranch = function(tenantId: Types.ObjectId, branchId: Types.ObjectId) {
  return this.findOne({
    tenant_id: tenantId,
    type: 'MAIN',
    assignedBranches: branchId,
    deleted_at: null
  });
};

// Instance method to activate warehouse
WarehouseSchema.methods.activate = function() {
  this.status = 'ACTIVE';
  return this.save();
};

// Instance method to deactivate warehouse
WarehouseSchema.methods.deactivate = function() {
  this.status = 'INACTIVE';
  return this.save();
};

// Instance method for soft delete
WarehouseSchema.methods.softDelete = function() {
  this.deleted_at = new Date();
  this.status = 'INACTIVE';
  return this.save();
};

export interface IWarehouseModel extends mongoose.Model<IWarehouse> {
  findByBranch(branchId: Types.ObjectId): mongoose.Query<IWarehouse[], IWarehouse>;
  findMainWarehouseForBranch(tenantId: Types.ObjectId, branchId: Types.ObjectId): mongoose.Query<IWarehouse | null, IWarehouse>;
}

export default mongoose.model<IWarehouse, IWarehouseModel>('Warehouse', WarehouseSchema);
