import mongoose from 'mongoose';
import { Clinic } from '../models';

/**
 * Migration script to set the first clinic as Main Clinic for existing tenants
 * This ensures backward compatibility with existing data
 */
export const setMainClinicsForExistingTenants = async (): Promise<void> => {
  try {
    console.log('🔄 Starting migration: Setting main clinics for existing tenants...');

    // Get all unique tenant IDs
    const tenantIds = await Clinic.distinct('tenant_id');

    console.log(`📊 Found ${tenantIds.length} tenants to process`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const tenantId of tenantIds) {
      // Find all clinics for this tenant
      const clinics = await Clinic.find({
        tenant_id: tenantId,
        is_active: true
      }).sort({ created_at: 1 }); // Sort by creation date, oldest first

      if (clinics.length === 0) {
        console.log(`⚠️  No active clinics found for tenant ${tenantId}`);
        skippedCount++;
        continue;
      }

      // Check if any clinic is already marked as main clinic
      const existingMainClinic = clinics.find(clinic => clinic.is_main_clinic === true);

      if (existingMainClinic) {
        console.log(`✅ Tenant ${tenantId} already has a main clinic: ${existingMainClinic.name}`);
        skippedCount++;
        continue;
      }

      // Set the first (oldest) clinic as main clinic
      const firstClinic = clinics[0];
      
      // Update first clinic to be main clinic
      await Clinic.findByIdAndUpdate(firstClinic._id, {
        is_main_clinic: true,
        parent_clinic_id: null
      });

      console.log(`✅ Set "${firstClinic.name}" as main clinic for tenant ${tenantId}`);

      // Update all other clinics to be sub clinics
      for (let i = 1; i < clinics.length; i++) {
        const subClinic = clinics[i];
        await Clinic.findByIdAndUpdate(subClinic._id, {
          is_main_clinic: false,
          parent_clinic_id: firstClinic._id
        });
        console.log(`   └─ Set "${subClinic.name}" as sub clinic`);
      }

      updatedCount++;
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   - Updated: ${updatedCount} tenants`);
    console.log(`   - Skipped: ${skippedCount} tenants`);
  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  }
};

// Note: To run this migration, import and call setMainClinicsForExistingTenants()
// from your migration runner or database setup script

export default setMainClinicsForExistingTenants;
