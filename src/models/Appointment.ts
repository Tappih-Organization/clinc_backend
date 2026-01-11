import mongoose, { Document, Schema } from 'mongoose';

export interface IAppointment extends Document {
  tenant_id: mongoose.Types.ObjectId;
  clinic_id: mongoose.Types.ObjectId;
  patient_id: mongoose.Types.ObjectId;
  doctor_id: mongoose.Types.ObjectId;
  nurse_id?: mongoose.Types.ObjectId;
  invoice_id?: mongoose.Types.ObjectId;
  appointment_date: Date;
  duration: number;
  status: string; // Dynamic status code from AppointmentStatus collection
  type: string;
  reason?: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

const AppointmentSchema: Schema = new Schema({
  tenant_id: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required'],
    index: true
  },
  clinic_id: {
    type: Schema.Types.ObjectId,
    ref: 'Clinic',
    required: [true, 'Clinic ID is required']
  },
  patient_id: {
    type: Schema.Types.ObjectId,
    ref: 'Patient',
    required: [true, 'Patient ID is required']
  },
  doctor_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Doctor ID is required']
  },
  invoice_id: {
  type: Schema.Types.ObjectId,
  ref: 'Invoice'
},
  nurse_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    validate: {
      validator: async function(value: mongoose.Types.ObjectId) {
        if (!value) return true; // Optional field
        const User = mongoose.model('User');
        const nurse = await User.findById(value);
        return nurse && nurse.role === 'nurse';
      },
      message: 'Selected user must be a nurse'
    }
  },
  appointment_date: {
    type: Date,
    required: [true, 'Appointment date is required'],
    validate: {
      validator: function(value: Date) {
        // For new appointments, require future dates
        // For updates, be more flexible - allow today or future dates
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        return new Date(value) >= today;
      },
      message: 'Appointment date cannot be in the past'
    }
  },
  duration: {
    type: Number,
    required: [true, 'Appointment duration is required'],
    min: [15, 'Appointment duration must be at least 15 minutes'],
    max: [240, 'Appointment duration cannot exceed 4 hours'],
    default: 30
  },
  status: {
    type: String,
    required: [true, 'Appointment status is required'],
    validate: {
      validator: async function(value: string) {
        if (!value) {
          // Value will be set by controller before save
          return true;
        }
        
        // Dynamic validation: check if status exists in AppointmentStatus collection
        const AppointmentStatus = mongoose.model('AppointmentStatus');
        // Access document properties correctly in validator context
        const doc = this as any;
        const tenant_id = doc.tenant_id;
        const clinic_id = doc.clinic_id;
        
        if (!tenant_id || !clinic_id) {
          // If tenant/clinic not set yet, allow it (will be validated in controller)
          return true;
        }
        
        const statusExists = await AppointmentStatus.findOne({
          tenant_id,
          clinic_id,
          code: value.toLowerCase(),
          is_active: true
        });
        
        return !!statusExists;
      },
      message: 'Status code does not exist or is not active for this clinic'
    }
  },
  type: {
    type: String,
    required: [true, 'Appointment type is required'],
    trim: true,
    maxlength: [100, 'Appointment type cannot exceed 100 characters'],
    enum: [
      'consultation',
      'follow-up',
      'check-up',
      'vaccination',
      'procedure',
      'emergency',
      'screening',
      'therapy',
      'other'
    ]
  },
  reason: {
    type: String,
    trim: true,
    maxlength: [200, 'Reason cannot exceed 200 characters']
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Create indexes for better query performance with tenant awareness
AppointmentSchema.index({ tenant_id: 1 });
AppointmentSchema.index({ tenant_id: 1, clinic_id: 1 });
AppointmentSchema.index({ tenant_id: 1, clinic_id: 1, appointment_date: 1 });
AppointmentSchema.index({ tenant_id: 1, clinic_id: 1, patient_id: 1, appointment_date: 1 });
AppointmentSchema.index({ tenant_id: 1, clinic_id: 1, appointment_date: 1, status: 1 });
AppointmentSchema.index({ tenant_id: 1, clinic_id: 1, nurse_id: 1, appointment_date: 1 });

// Prevent double booking - same doctor at the same time within same tenant/clinic
AppointmentSchema.index(
  { tenant_id: 1, clinic_id: 1, doctor_id: 1, appointment_date: 1 },
  { 
    unique: true,
    partialFilterExpression: { 
      status: { $nin: ['cancelled', 'no-show'] } 
    }
  }
);

// Virtual to calculate end time
AppointmentSchema.virtual('end_time').get(function() {
  const appointmentDate = this.appointment_date as Date;
  const duration = this.duration as number;
  return new Date(appointmentDate.getTime() + (duration * 60000));
});

// Method to check if appointment is upcoming
AppointmentSchema.methods.isUpcoming = async function(this: IAppointment) {
  const AppointmentStatus = mongoose.model('AppointmentStatus');
  const statusConfig = await AppointmentStatus.findOne({
    tenant_id: this.tenant_id,
    clinic_id: this.clinic_id,
    code: this.status,
    is_active: true
  });
  
  // Check if status is cancelled (fallback to hard-coded check if status config doesn't exist)
  const isCancelled = statusConfig ? statusConfig.code === 'cancelled' : this.status === 'cancelled';
  return this.appointment_date > new Date() && !isCancelled;
};

// Method to check if appointment can be cancelled
AppointmentSchema.methods.canBeCancelled = async function(this: IAppointment) {
  const now = new Date();
  const appointmentTime = new Date(this.appointment_date);
  const timeDiff = appointmentTime.getTime() - now.getTime();
  const hoursDiff = timeDiff / (1000 * 3600);
  
  // Check if status allows cancellation (scheduled or confirmed)
  const AppointmentStatus = mongoose.model('AppointmentStatus');
  const statusConfig = await AppointmentStatus.findOne({
    tenant_id: this.tenant_id,
    clinic_id: this.clinic_id,
    code: this.status,
    is_active: true
  });
  
  // Allow cancellation for scheduled/confirmed statuses or if status config doesn't exist (fallback)
  const cancellableStatuses = ['scheduled', 'confirmed'];
  return hoursDiff >= 24 && (cancellableStatuses.includes(this.status) || !statusConfig);
};

export default mongoose.model<IAppointment>('Appointment', AppointmentSchema); 