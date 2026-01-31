import mongoose, { Document, Schema } from 'mongoose';

export interface IAppointmentStatus extends Document {
  tenant_id: mongoose.Types.ObjectId;
  clinic_id: mongoose.Types.ObjectId;
  code: string; // Unique code: 'scheduled', 'confirmed', etc.
  name_en: string;
  name_ar: string;
  color: string; // Hex color: '#3b82f6'
  icon: string; // Icon name: 'Clock', 'CheckCircle', etc.
  order: number;
  show_in_calendar: boolean; // Whether to show appointments with this status in calendar
  is_active: boolean;
  is_default: boolean; // Default status for new appointments
  description?: string;
  created_at: Date;
  updated_at: Date;
}

const AppointmentStatusSchema: Schema = new Schema({
  tenant_id: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required']
  },
  clinic_id: {
    type: Schema.Types.ObjectId,
    ref: 'Clinic',
    required: [true, 'Clinic ID is required']
  },
  code: {
    type: String,
    required: [true, 'Status code is required'],
    trim: true,
    lowercase: true
  },
  name_en: {
    type: String,
    required: [true, 'English name is required'],
    trim: true,
    maxlength: [100, 'English name cannot exceed 100 characters']
  },
  name_ar: {
    type: String,
    required: [true, 'Arabic name is required'],
    trim: true,
    maxlength: [100, 'Arabic name cannot exceed 100 characters']
  },
  color: {
    type: String,
    required: [true, 'Color is required'],
    match: [/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color code']
  },
  icon: {
    type: String,
    required: [true, 'Icon is required'],
    trim: true,
    default: 'Clock'
  },
  order: {
    type: Number,
    required: [true, 'Order is required'],
    min: [1, 'Order must be at least 1'],
    default: 1
  },
  show_in_calendar: {
    type: Boolean,
    default: false
  },
  is_active: {
    type: Boolean,
    default: true
  },
  is_default: {
    type: Boolean,
    default: false
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Compound indexes for performance
AppointmentStatusSchema.index({ tenant_id: 1, clinic_id: 1, is_active: 1 });
AppointmentStatusSchema.index({ tenant_id: 1, clinic_id: 1, code: 1 }, { unique: true });
AppointmentStatusSchema.index({ tenant_id: 1, clinic_id: 1, order: 1 });
AppointmentStatusSchema.index({ tenant_id: 1, clinic_id: 1, show_in_calendar: 1, is_active: 1 });

// Prevent duplicate codes within same tenant/clinic
AppointmentStatusSchema.index(
  { tenant_id: 1, clinic_id: 1, code: 1 },
  { unique: true, name: 'unique_status_code_per_clinic' }
);

export default mongoose.model<IAppointmentStatus>('AppointmentStatus', AppointmentStatusSchema);

