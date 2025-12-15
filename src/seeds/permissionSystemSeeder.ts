import mongoose from 'mongoose';
import { seedPermissions } from './permissionSeeder';
import { seedRoles } from './roleSeeder';
import UserClinic from '../models/UserClinic';
import Role from '../models/Role';

/**
 * Master seeder for the permission system
 * Runs all permission-related seeders in the correct order
 */
export async function seedPermissionSystem() {
  try {
    console.log('🚀 Starting Permission System Setup...\n');
    
    // Step 1: Seed Permissions
    console.log('📋 Step 1: Seeding Permissions');
    const permissionResult = await seedPermissions();
    console.log(`✅ Permissions: ${permissionResult.created} created, ${permissionResult.updated} updated\n`);
    
    // Step 2: Seed Roles
    console.log('👥 Step 2: Seeding Roles');
    const roleResult = await seedRoles();
    console.log(`✅ Roles: ${roleResult.created} created, ${roleResult.updated} updated\n`);
    
    // Step 3: Migrate existing users (if any)
    console.log('🔄 Step 3: Migrating Existing Users');
    const migrationResult = await migrateExistingUsers();
    console.log(`✅ Migration: ${migrationResult.migrated} users migrated, ${migrationResult.skipped} skipped\n`);
    
    console.log('🎉 Permission System Setup Complete!');
    console.log('═'.repeat(50));
    console.log('Summary:');
    console.log(`- Permissions: ${permissionResult.total} total`);
    console.log(`- Roles: ${roleResult.total} total`);
    console.log(`- Users migrated: ${migrationResult.migrated}`);
    console.log('═'.repeat(50));
    
    return {
      permissions: permissionResult,
      roles: roleResult,
      migration: migrationResult
    };
  } catch (error) {
    console.error('❌ Error setting up permission system:', error);
    throw error;
  }
}

/**
 * Migrate existing users from old role system to new permission system
 */
async function migrateExistingUsers() {
  try {
    console.log('Checking for existing users to migrate...');
    
    // Find all UserClinic records that might need migration
    // These would be records that have the old 'role' field but no roles array
    const usersToMigrate = await UserClinic.find({
      $or: [
        { roles: { $exists: false } },
        { roles: { $size: 0 } }
      ]
    }).populate('user_id clinic_id');
    
    console.log(`Found ${usersToMigrate.length} users that need migration`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const userClinic of usersToMigrate) {
      try {
        // Get the old role (this assumes the old model had a 'role' field)
        const oldRole = (userClinic as any).role;
        
        if (!oldRole) {
          console.log(`Skipping user ${userClinic.user_id} - no old role found`);
          skippedCount++;
          continue;
        }
        
        // Find the corresponding role in the new system
        const newRole = await Role.findOne({ 
          name: oldRole, 
          is_system_role: true 
        });
        
        if (!newRole) {
          console.log(`Warning: Role '${oldRole}' not found for user ${userClinic.user_id}`);
          // Assign default 'staff' role
          const staffRole = await Role.findOne({ 
            name: 'staff', 
            is_system_role: true 
          });
          
          if (staffRole) {
            userClinic.roles = [{
              role_id: staffRole._id,
              assigned_at: new Date(),
              assigned_by: userClinic.user_id, // Self-assigned during migration
              is_primary: true
            }];
          }
        } else {
          // Assign the found role
          userClinic.roles = [{
            role_id: newRole._id,
            assigned_at: new Date(),
            assigned_by: userClinic.user_id, // Self-assigned during migration
            is_primary: true
          }];
        }
        
        // Clear old permissions array if it exists
        if ((userClinic as any).permissions) {
          delete (userClinic as any).permissions;
        }
        
        // Add migration audit entry
        userClinic.auditPermissionChange('role_migrated', userClinic.user_id, {
          old_role: oldRole,
          new_role_id: userClinic.roles[0].role_id,
          migration_date: new Date()
        });
        
        await userClinic.save();
        migratedCount++;
        
        console.log(`✓ Migrated user ${userClinic.user_id} from '${oldRole}' to new role system`);
      } catch (error) {
        console.error(`Error migrating user ${userClinic.user_id}:`, error);
        skippedCount++;
      }
    }
    
    return { migrated: migratedCount, skipped: skippedCount };
  } catch (error) {
    console.error('Error during user migration:', error);
    return { migrated: 0, skipped: 0 };
  }
}

/**
 * Rollback function to undo permission system setup (use with caution)
 */
export async function rollbackPermissionSystem() {
  try {
    console.log('⚠️  Starting Permission System Rollback...\n');
    
    // This is a destructive operation - only use in development
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Rollback is not allowed in production environment');
    }
    
    console.log('🗑️  Removing all permissions...');
    const deletedPermissions = await mongoose.model('Permission').deleteMany({});
    console.log(`Deleted ${deletedPermissions.deletedCount} permissions`);
    
    console.log('🗑️  Removing all custom roles...');
    const deletedRoles = await mongoose.model('Role').deleteMany({ is_system_role: true });
    console.log(`Deleted ${deletedRoles.deletedCount} roles`);
    
    console.log('🔄 Resetting user-clinic relationships...');
    // Since roles are required, it's cleaner to delete UserClinic documents during rollback
    // rather than trying to create invalid documents with empty roles
    const deletedUserClinics = await UserClinic.deleteMany({});
    console.log(`Reset ${deletedUserClinics.deletedCount} user-clinic relationships`);
    console.log('✅ Rollback completed');
    
    return {
      deletedPermissions: deletedPermissions.deletedCount,
      deletedRoles: deletedRoles.deletedCount,
      resetUsers: deletedUserClinics.deletedCount
    };
  } catch (error) {
    console.error('❌ Error during rollback:', error);
    throw error;
  }
}

/**
 * Utility function to create a custom role for a specific clinic
 */
export async function createCustomRole(
  clinicId: string, 
  roleName: string, 
  displayName: string, 
  description: string, 
  permissions: string[], 
  createdBy: string
) {
  try {
    // Verify all permissions exist
    for (const permissionName of permissions) {
      const permission = await mongoose.model('Permission').findOne({ name: permissionName });
      if (!permission) {
        throw new Error(`Permission '${permissionName}' does not exist`);
      }
    }
    
    // Create role permissions array
    const rolePermissions = permissions.map(permissionName => ({
      permission_name: permissionName,
      granted: true,
      granted_at: new Date(),
      granted_by: new mongoose.Types.ObjectId(createdBy)
    }));
    
    // Create the custom role
    const customRole = new Role({
      name: roleName.toLowerCase().replace(/\s+/g, '_'),
      display_name: displayName,
      description: description,
      clinic_id: new mongoose.Types.ObjectId(clinicId),
      is_system_role: false,
      is_active: true,
      permissions: rolePermissions,
      color: '#6366f1', // Default color
      icon: 'user-group',
      priority: 50, // Default priority
      can_be_modified: true,
      can_be_deleted: true,
      created_by: new mongoose.Types.ObjectId(createdBy)
    });
    
    await customRole.save();
    console.log(`Created custom role '${displayName}' for clinic ${clinicId}`);
    
    return customRole;
  } catch (error) {
    console.error('Error creating custom role:', error);
    throw error;
  }
}

/**
 * Run the seeder from command line
 */
if (require.main === module) {
  // Connect to MongoDB (you'll need to configure this based on your setup)
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clinicpro')
    .then(() => {
      console.log('Connected to MongoDB');
      return seedPermissionSystem();
    })
    .then((result) => {
      console.log('Seeding completed successfully:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

export default seedPermissionSystem;
