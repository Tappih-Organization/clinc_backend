import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IClinic extends Document {
  _id: Types.ObjectId;
  tenant_id: Types.ObjectId;
  name: string;
  code: string; // Unique clinic identifier (e.g., "CLN001")
  description?: string;
  is_main_clinic: boolean; // true for only one clinic per tenant
  parent_clinic_id: Types.ObjectId | null; // required for sub clinics, null for main clinic
  address: {
    street: string;
    city: string;
    state?: string;
    zipCode?: string;
    country: string;
  };
  contact: {
    phone: string;
    email: string;
    website?: string;
  };
  settings: {
    timezone: string;
    currency: string;
    language: string;
    working_hours: {
      monday: { start: string; end: string; isWorking: boolean; };
      tuesday: { start: string; end: string; isWorking: boolean; };
      wednesday: { start: string; end: string; isWorking: boolean; };
      thursday: { start: string; end: string; isWorking: boolean; };
      friday: { start: string; end: string; isWorking: boolean; };
      saturday: { start: string; end: string; isWorking: boolean; };
      sunday: { start: string; end: string; isWorking: boolean; };
    };
  };
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Define day schedule schema
const DayScheduleSchema = new Schema({
  start: {
    type: String,
    required: true,
    default: "09:00"
  },
  end: {
    type: String,
    required: true,
    default: "17:00"
  },
  isWorking: {
    type: Boolean,
    required: true,
    default: true
  }
}, { _id: false });

// Define working hours schema
const WorkingHoursSchema = new Schema({
  monday: { type: DayScheduleSchema, default: { start: "09:00", end: "17:00", isWorking: true } },
  tuesday: { type: DayScheduleSchema, default: { start: "09:00", end: "17:00", isWorking: true } },
  wednesday: { type: DayScheduleSchema, default: { start: "09:00", end: "17:00", isWorking: true } },
  thursday: { type: DayScheduleSchema, default: { start: "09:00", end: "17:00", isWorking: true } },
  friday: { type: DayScheduleSchema, default: { start: "09:00", end: "17:00", isWorking: true } },
  saturday: { type: DayScheduleSchema, default: { start: "09:00", end: "13:00", isWorking: false } },
  sunday: { type: DayScheduleSchema, default: { start: "00:00", end: "00:00", isWorking: false } }
}, { _id: false });

const ClinicSchema: Schema = new Schema({
  tenant_id: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: [true, 'Tenant ID is required'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'Clinic name is required'],
    trim: true,
    maxlength: [200, 'Clinic name cannot exceed 200 characters'],
    minlength: [2, 'Clinic name must be at least 2 characters']
  },
  code: {
    type: String,
    required: [true, 'Clinic code is required'],
    trim: true,
    uppercase: true,
    maxlength: [20, 'Clinic code cannot exceed 20 characters'],
    minlength: [3, 'Clinic code must be at least 3 characters'],
    match: [/^[A-Z0-9]+$/, 'Clinic code must contain only uppercase letters and numbers']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  is_main_clinic: {
    type: Boolean,
    default: false,
    index: true
  },
  parent_clinic_id: {
    type: Schema.Types.ObjectId,
    ref: 'Clinic',
    default: null,
    index: true,
    validate: {
      validator: function(this: IClinic, value: Types.ObjectId | null) {
        // Main clinic must have parent_clinic_id = null
        if (this.is_main_clinic && value !== null) {
          return false;
        }
        // Sub clinic must have parent_clinic_id set
        if (!this.is_main_clinic && value === null) {
          return false;
        }
        return true;
      },
      message: 'Main clinic must have parent_clinic_id = null, Sub clinic must have parent_clinic_id set'
    }
  },
  address: {
    street: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true,
      maxlength: [200, 'Street address cannot exceed 200 characters']
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      maxlength: [100, 'City cannot exceed 100 characters']
    },
    state: {
      type: String,
      required: false,
      trim: true,
      maxlength: [100, 'State cannot exceed 100 characters']
    },
    zipCode: {
      type: String,
      required: false,
      trim: true,
      maxlength: [20, 'Zip code cannot exceed 20 characters']
    },
    neighborhood: {
      type: String,
      required: false,
      trim: true,
      maxlength: [100, 'Neighborhood cannot exceed 100 characters']
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      maxlength: [100, 'Country cannot exceed 100 characters'],
      default: 'United States'
    }
  },
  contact: {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      maxlength: [20, 'Phone number cannot exceed 20 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    website: {
      type: String,
      trim: true,
      maxlength: [200, 'Website URL cannot exceed 200 characters']
    }
  },
  settings: {
    timezone: {
      type: String,
      required: [true, 'Timezone is required'],
      default: 'America/New_York'
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      default: 'USD',
      enum: ['USD', 'SAR', 'EGP']
    },
    language: {
      type: String,
      required: [true, 'Language is required'],
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ar', 'hi', 'zh', 'ja']
    },
    working_hours: {
      type: WorkingHoursSchema,
      required: true,
      default: () => ({})
    }
  },
  is_active: {
    type: Boolean,
    default: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Indexes for better performance with tenant awareness
ClinicSchema.index({ tenant_id: 1 });
ClinicSchema.index({ tenant_id: 1, code: 1 }, { unique: true }); // Unique code per tenant
ClinicSchema.index({ tenant_id: 1, is_active: 1 });
ClinicSchema.index({ tenant_id: 1, 'contact.email': 1 });
ClinicSchema.index({ tenant_id: 1, is_main_clinic: 1 }); // For finding main clinic per tenant
ClinicSchema.index({ tenant_id: 1, parent_clinic_id: 1 }); // For finding sub clinics
ClinicSchema.index({ parent_clinic_id: 1 }); // For finding all sub clinics of a main clinic

// Virtual properties
ClinicSchema.virtual('full_address').get(function(this: IClinic) {
  const statePart = this.address.state ? `, ${this.address.state}` : '';
  const zipPart = this.address.zipCode ? ` ${this.address.zipCode}` : '';
  return `${this.address.street}, ${this.address.city}${statePart}${zipPart}, ${this.address.country}`;
});

// Static methods
ClinicSchema.statics.findByCode = function(code: string) {
  return this.findOne({ code: code.toUpperCase(), is_active: true });
};

ClinicSchema.statics.findActive = function() {
  return this.find({ is_active: true }).sort({ name: 1 });
};

// Instance methods
ClinicSchema.methods.activate = function() {
  this.is_active = true;
  return this.save();
};

ClinicSchema.methods.deactivate = function() {
  this.is_active = false;
  return this.save();
};

ClinicSchema.methods.updateWorkingHours = function(day: string, schedule: { start: string; end: string; isWorking: boolean }) {
  this.settings.working_hours[day] = schedule;
  return this.save();
};

// Pre-save middleware
ClinicSchema.pre('save', function(next) {
  if (!this.isNew) {
    this.updated_at = new Date();
  }
  next();
});

// Pre-save middleware to generate clinic code if not provided
ClinicSchema.pre<IClinic>('save', function(next) {
  if (this.isNew && !this.code) {
    // Generate a clinic code based on name
    const nameWords = (this.name as string).split(' ');
    const initials = nameWords.map((word: string) => word.charAt(0).toUpperCase()).join('');
    const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.code = `${initials}${randomNum}`;
  }
  next();
});

// Pre-save middleware to ensure only one main clinic per tenant
ClinicSchema.pre<IClinic>('save', async function(next) {
  if (this.isNew && this.is_main_clinic) {
    // Check if there's already a main clinic for this tenant
    const existingMainClinic = await mongoose.model('Clinic').findOne({
      tenant_id: this.tenant_id,
      is_main_clinic: true,
      is_active: true
    });
    
    if (existingMainClinic) {
      return next(new Error('Only one main clinic is allowed per tenant'));
    }
  }
  next();
});

export const Clinic = mongoose.model<IClinic>('Clinic', ClinicSchema);
export default Clinic; 