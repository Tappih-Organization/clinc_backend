import mongoose from 'mongoose';
import AppointmentStatus from '../models/AppointmentStatus';
import Clinic from '../models/Clinic';

// Default appointment statuses
const DEFAULT_STATUSES = [
  {
    code: 'scheduled',
    name_en: 'Scheduled',
    name_ar: 'مجدول',
    color: '#3b82f6',
    icon: 'Clock',
    order: 1,
    show_in_calendar: true,
    is_active: true,
    is_default: true,
  },
  {
    code: 'confirmed',
    name_en: 'Confirmed',
    name_ar: 'مؤكد',
    color: '#10b981',
    icon: 'CheckCircle',
    order: 2,
    show_in_calendar: true,
    is_active: true,
    is_default: false,
  },
  {
    code: 'in-progress',
    name_en: 'In Progress',
    name_ar: 'قيد التنفيذ',
    color: '#f59e0b',
    icon: 'Loader2',
    order: 3,
    show_in_calendar: true,
    is_active: true,
    is_default: false,
  },
  {
    code: 'completed',
    name_en: 'Completed',
    name_ar: 'مكتمل',
    color: '#10b981',
    icon: 'CheckCircle',
    order: 4,
    show_in_calendar: true,
    is_active: true,
    is_default: false,
  },
  {
    code: 'cancelled',
    name_en: 'Cancelled',
    name_ar: 'ملغي',
    color: '#ef4444',
    icon: 'XCircle',
    order: 5,
    show_in_calendar: false,
    is_active: true,
    is_default: false,
  },
  {
    code: 'no-show',
    name_en: 'No Show',
    name_ar: 'لم يحضر',
    color: '#f59e0b',
    icon: 'AlertCircle',
    order: 6,
    show_in_calendar: false,
    is_active: true,
    is_default: false,
  },
];

export async function createDefaultAppointmentStatuses(): Promise<void> {
  try {
    console.log('🔄 Starting default appointment statuses creation...');

    // Get all clinics
    const clinics = await Clinic.find({ is_active: true }).lean();

    if (clinics.length === 0) {
      console.log('⚠️  No active clinics found. Skipping status creation.');
      return;
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const clinic of clinics) {
      const tenantId = clinic.tenant_id;
      const clinicId = clinic._id;

      for (const statusData of DEFAULT_STATUSES) {
        // Check if status already exists for this clinic
        const existingStatus = await AppointmentStatus.findOne({
          tenant_id: tenantId,
          clinic_id: clinicId,
          code: statusData.code,
        });

        if (existingStatus) {
          skippedCount++;
          continue;
        }

        // Create new status
        const status = new AppointmentStatus({
          tenant_id: tenantId,
          clinic_id: clinicId,
          ...statusData,
        });

        await status.save();
        createdCount++;
      }
    }

    console.log(`✅ Default appointment statuses creation completed:`);
    console.log(`   - Created: ${createdCount} statuses`);
    console.log(`   - Skipped: ${skippedCount} statuses (already exist)`);
  } catch (error) {
    console.error('❌ Error creating default appointment statuses:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clinic-management')
    .then(async () => {
      console.log('📦 Connected to MongoDB');
      await createDefaultAppointmentStatuses();
      await mongoose.disconnect();
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

