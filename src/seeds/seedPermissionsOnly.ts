import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

// Import centralized database connection
import connectDB, { gracefulShutdown } from '../config/database';

// Import seeder functions
import { seedPermissions } from './permissionSeeder';

dotenv.config();

/**
 * Run permissions seeding only
 */
async function runPermissionsSeeding(): Promise<void> {
  try {
    console.log('Starting Permissions Seeding...\n');
    console.log('='.repeat(60));

    // Connect to database
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to database successfully\n');

    // Seed permissions
    console.log('Seeding Permissions...');
    console.log('-'.repeat(40));
    const result = await seedPermissions();
    
    console.log('\n' + '='.repeat(60));
    console.log('PERMISSIONS SEEDING COMPLETED!');
    console.log('='.repeat(60));
    console.log('\nSUMMARY:');
    console.log(`   Created: ${result.created} permissions`);
    console.log(`   Updated: ${result.updated} permissions`);
    console.log(`   Total: ${result.total} permissions processed`);
    
    // Graceful shutdown
    await gracefulShutdown();
    console.log('\nDatabase connection closed gracefully');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR DURING PERMISSIONS SEEDING');
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
  runPermissionsSeeding();
}

export default runPermissionsSeeding;
