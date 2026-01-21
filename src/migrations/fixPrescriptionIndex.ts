import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Migration script to fix prescription_id unique index
 * 
 * This migration removes the old global unique index on prescription_id
 * and ensures the compound unique index (tenant_id + clinic_id + prescription_id) is in place.
 * 
 * Usage: npx ts-node src/migrations/fixPrescriptionIndex.ts
 */

async function fixPrescriptionIndex() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clinic-pro';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

    const collection = db.collection('prescriptions');
    
    // Get all indexes
    console.log('\n📋 Checking current indexes...');
    const indexes = await collection.indexes();
    
    console.log('Current indexes:');
    indexes.forEach((index: any) => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    // Check for old unique index on prescription_id only
    const oldIndex = indexes.find((index: any) => 
      index.name === 'prescription_id_1' || 
      (Object.keys(index.key).length === 1 && index.key.prescription_id === 1 && index.unique)
    );

    if (oldIndex) {
      console.log(`\n⚠️  Found old unique index: ${oldIndex.name}`);
      console.log('🗑️  Dropping old index...');
      
      try {
        await collection.dropIndex(oldIndex.name);
        console.log(`✅ Successfully dropped index: ${oldIndex.name}`);
      } catch (error: any) {
        if (error.codeName === 'IndexNotFound') {
          console.log(`ℹ️  Index ${oldIndex.name} not found (may have been already dropped)`);
        } else {
          throw error;
        }
      }
    } else {
      console.log('\n✅ No old unique index found on prescription_id');
    }

    // Check for compound unique index
    const compoundIndex = indexes.find((index: any) => 
      index.key.tenant_id === 1 && 
      index.key.clinic_id === 1 && 
      index.key.prescription_id === 1 && 
      index.unique
    );

    if (!compoundIndex) {
      console.log('\n📝 Creating compound unique index (tenant_id + clinic_id + prescription_id)...');
      try {
        await collection.createIndex(
          { tenant_id: 1, clinic_id: 1, prescription_id: 1 },
          { unique: true, name: 'tenant_id_1_clinic_id_1_prescription_id_1' }
        );
        console.log('✅ Successfully created compound unique index');
      } catch (error: any) {
        console.error('❌ Error creating compound index:', error.message);
        // Don't throw - the index might already exist with a different name
      }
    } else {
      console.log('\n✅ Compound unique index already exists');
    }

    // Verify final indexes
    console.log('\n📋 Final indexes:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach((index: any) => {
      const isUnique = index.unique ? ' (UNIQUE)' : '';
      console.log(`  - ${index.name}:`, JSON.stringify(index.key) + isUnique);
    });

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run migration
if (require.main === module) {
  fixPrescriptionIndex()
    .then(() => {
      console.log('\n🎉 Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration script failed:', error);
      process.exit(1);
    });
}

export default fixPrescriptionIndex;
