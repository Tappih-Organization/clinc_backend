import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

// Import centralized database connection
import connectDB, { gracefulShutdown } from '../config/database';
import Role from '../models/Role';
import Permission from '../models/Permission';

dotenv.config();

/**
 * Update existing roles with new warehouse and item permissions
 */
async function updateRolesWithWarehousePermissions(): Promise<void> {
  try {
    console.log('Starting Role Permissions Update...\n');
    console.log('='.repeat(60));

    // Connect to database
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to database successfully\n');

    // Define warehouse and item permissions
    const warehousePermissions = [
      'warehouse.view',
      'warehouse.create',
      'warehouse.update',
      'warehouse.delete',
      'warehouse.assign_branches',
      'item.view',
      'item.create',
      'item.update'
    ];

    // Verify all permissions exist
    console.log('Verifying permissions exist...');
    const existingPermissions = await Permission.find({
      name: { $in: warehousePermissions }
    });
    
    const existingPermissionNames = existingPermissions.map(p => p.name);
    const missingPermissions = warehousePermissions.filter(
      p => !existingPermissionNames.includes(p)
    );
    
    if (missingPermissions.length > 0) {
      console.warn(`⚠️  Warning: Some permissions are missing: ${missingPermissions.join(', ')}`);
      console.warn('Please run seed:permissions first to create these permissions.');
    }

    // Define role updates
    const roleUpdates: Record<string, string[]> = {
      admin: [
        'warehouse.view',
        'warehouse.create',
        'warehouse.update',
        'warehouse.delete',
        'warehouse.assign_branches',
        'item.view',
        'item.create',
        'item.update'
      ],
      nurse: [
        'warehouse.view',
        'warehouse.create',
        'warehouse.update',
        'warehouse.assign_branches',
        'item.view',
        'item.create',
        'item.update'
      ],
      receptionist: [
        'warehouse.view',
        'item.view'
      ],
      accountant: [
        'warehouse.view',
        'item.view'
      ],
      staff: [
        'warehouse.view',
        'item.view'
      ],
      doctor: [
        'warehouse.view',
        'item.view'
      ]
    };

    let updatedCount = 0;
    let skippedCount = 0;

    // Update each role
    for (const [roleName, permissionsToAdd] of Object.entries(roleUpdates)) {
      try {
        const role = await Role.findOne({ 
          name: roleName, 
          is_system_role: true 
        });

        if (!role) {
          console.log(`⚠️  Role '${roleName}' not found, skipping...`);
          skippedCount++;
          continue;
        }

        // Get existing permission names
        const existingPermissionNames = role.permissions.map(
          (p: any) => p.permission_name
        );

        // Add new permissions that don't already exist
        let addedCount = 0;
        for (const permissionName of permissionsToAdd) {
          if (!existingPermissionNames.includes(permissionName)) {
            // Verify permission exists
            const permission = await Permission.findOne({ name: permissionName });
            if (permission) {
              role.permissions.push({
                permission_name: permissionName,
                granted: true,
                granted_at: new Date()
              });
              addedCount++;
            } else {
              console.warn(`⚠️  Permission '${permissionName}' not found, skipping...`);
            }
          }
        }

        if (addedCount > 0) {
          await role.save();
          console.log(`✅ Updated role '${roleName}': Added ${addedCount} new permission(s)`);
          updatedCount++;
        } else {
          console.log(`ℹ️  Role '${roleName}': All permissions already exist`);
        }
      } catch (error) {
        console.error(`❌ Error updating role '${roleName}':`, error);
        skippedCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('ROLE PERMISSIONS UPDATE COMPLETED!');
    console.log('='.repeat(60));
    console.log('\nSUMMARY:');
    console.log(`   Updated: ${updatedCount} roles`);
    console.log(`   Skipped: ${skippedCount} roles`);
    
    // Graceful shutdown
    await gracefulShutdown();
    console.log('\nDatabase connection closed gracefully');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR DURING ROLE PERMISSIONS UPDATE');
    console.error('='.repeat(60));
    
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
    
    console.error('\nAttempting graceful shutdown...');
    await gracefulShutdown();
    
    process.exit(1);
  }
}

// Execute if this file is run directly
if (require.main === module) {
  updateRolesWithWarehousePermissions();
}

export default updateRolesWithWarehousePermissions;
