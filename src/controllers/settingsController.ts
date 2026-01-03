import { Request, Response } from 'express';
import Settings, { ISettings } from '../models/Settings';
import Clinic from '../models/Clinic';
import { AuthRequest } from '../types/express';

/**
 * @swagger
 * components:
 *   schemas:
 *     ClinicSettings:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Settings ID
 *         clinic:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *               description: Clinic name
 *             address:
 *               type: string
 *               description: Clinic address
 *             phone:
 *               type: string
 *               description: Phone number
 *             email:
 *               type: string
 *               description: Email address
 *             website:
 *               type: string
 *               description: Website URL
 *             description:
 *               type: string
 *               description: Clinic description
 *             logo:
 *               type: string
 *               description: Logo URL
 *         workingHours:
 *           type: object
 *           additionalProperties:
 *             type: object
 *             properties:
 *               isOpen:
 *                 type: boolean
 *               start:
 *                 type: string
 *               end:
 *                 type: string
 *         financial:
 *           type: object
 *           properties:
 *             currency:
 *               type: string
 *             taxRate:
 *               type: number
 *             invoicePrefix:
 *               type: string
 *             paymentTerms:
 *               type: number
 *             defaultDiscount:
 *               type: number
 *         notifications:
 *           type: object
 *           properties:
 *             emailNotifications:
 *               type: boolean
 *             smsNotifications:
 *               type: boolean
 *             appointmentReminders:
 *               type: boolean
 *             paymentReminders:
 *               type: boolean
 *             lowStockAlerts:
 *               type: boolean
 *             systemAlerts:
 *               type: boolean
 *         security:
 *           type: object
 *           properties:
 *             twoFactorAuth:
 *               type: boolean
 *             sessionTimeout:
 *               type: number
 *             passwordExpiry:
 *               type: number
 *             backupFrequency:
 *               type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get clinic settings
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Clinic-Id
 *         required: true
 *         schema:
 *           type: string
 *         description: Clinic ID for context
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *       404:
 *         description: Settings not found
 *       500:
 *         description: Server error
 */
export const getSettings = async (req: AuthRequest, res: Response) => {
  try {
    const clinicId = req.clinic_id;
    
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: 'Clinic context is required'
      });
    }

    // Try to find existing settings for this clinic
    let settings = await Settings.findOne({ clinicId });
    
    // If no settings exist, create default settings
    if (!settings) {
      const defaultSettings = {
        clinicId,
        clinic: {
          name: "Your Clinic Name",
          address: "Your Clinic Address",
          phone: "+1 (000) 000-0000",
          email: "contact@yourclinic.com",
          website: "",
          description: "",
          logo: "",
        },
        workingHours: {
          monday: { isOpen: true, start: "09:00", end: "17:00" },
          tuesday: { isOpen: true, start: "09:00", end: "17:00" },
          wednesday: { isOpen: true, start: "09:00", end: "17:00" },
          thursday: { isOpen: true, start: "09:00", end: "17:00" },
          friday: { isOpen: true, start: "09:00", end: "15:00" },
          saturday: { isOpen: false, start: "09:00", end: "13:00" },
          sunday: { isOpen: false, start: "10:00", end: "14:00" },
        },
        financial: {
          currency: "USD",
          taxRate: 10,
          invoicePrefix: "INV",
          paymentTerms: 30,
          defaultDiscount: 0,
        },
        notifications: {
          emailNotifications: true,
          smsNotifications: true,
          appointmentReminders: true,
          paymentReminders: true,
          lowStockAlerts: true,
          systemAlerts: true,
        },
        security: {
          twoFactorAuth: false,
          sessionTimeout: 60,
          passwordExpiry: 90,
          backupFrequency: "daily",
        }
      };
      
      settings = new Settings(defaultSettings);
      await settings.save();
      console.log(`✅ Created default settings for clinic: ${clinicId}`);
    }

    return res.json({
      success: true,
      data: settings.toJSON(),
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch settings',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * @swagger
 * /api/settings:
 *   put:
 *     summary: Update clinic settings
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Clinic-Id
 *         required: true
 *         schema:
 *           type: string
 *         description: Clinic ID for context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clinic:
 *                 type: object
 *               workingHours:
 *                 type: object
 *               financial:
 *                 type: object
 *               notifications:
 *                 type: object
 *               security:
 *                 type: object
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Settings not found
 *       500:
 *         description: Server error
 */
// export const updateSettings = async (req: AuthRequest, res: Response) => {
//   try {
//     const clinicId = req.clinic_id;
    
//     if (!clinicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Clinic context is required'
//       });
//     }

//     const { clinic, workingHours, financial, notifications, security } = req.body;

//     // Basic validation for clinic information if provided
//     if (clinic && (!clinic.name || !clinic.email || !clinic.phone || !clinic.address)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Missing required clinic information (name, email, phone, address)'
//       });
//     }

//     // Prepare update data - only include provided fields
//     const updateData: any = {
//       clinicId,
//       updatedAt: new Date()
//     };

//     if (clinic) updateData.clinic = clinic;
//     if (workingHours) updateData.workingHours = workingHours;
//     if (financial) updateData.financial = financial;
//     if (notifications) updateData.notifications = notifications;
//     if (security) updateData.security = security;

//     // Use findOneAndUpdate with upsert to create if not exists
//     const updatedSettings = await Settings.findOneAndUpdate(
//       { clinicId },
//       updateData,
//       {
//         new: true,
//         upsert: true,
//         runValidators: true,
//         setDefaultsOnInsert: true
//       }
//     );

//     if (!updatedSettings) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to update settings'
//       });
//     }

//     console.log(`✅ Settings updated successfully for clinic: ${clinicId}`);

//     return res.json({
//       success: true,
//       message: 'Settings updated successfully',
//       data: updatedSettings.toJSON(),
//     });
//   } catch (error) {
//     console.error('Error updating settings:', error);
    
//     // Handle validation errors
//     if (error instanceof Error && error.name === 'ValidationError') {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid data provided',
//         error: error.message
//       });
//     }
    
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to update settings',
//       error: error instanceof Error ? error.message : 'Unknown error'
//     });
//   }
// };
export const updateSettings = async (req: AuthRequest, res: Response) => {
  try {
    const clinicId = req.clinic_id;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: 'Clinic context is required'
      });
    }

    const { clinic, workingHours, financial, notifications, security } = req.body;

    // Find existing settings
    const existingSettings = await Settings.findOne({ clinicId });
    if (!existingSettings) {
      return res.status(404).json({
        success: false,
        message: 'Settings not found for this clinic'
      });
    }

    // Merge clinic data (keep old values if not provided)
    if (clinic) {
      existingSettings.clinic = {
        ...existingSettings.clinic,
        ...clinic
      };
    }

    // Merge working hours
    if (workingHours) {
      existingSettings.workingHours = {
        ...existingSettings.workingHours,
        ...workingHours
      };
    }

    // Merge other sections
    if (financial) {
      existingSettings.financial = {
        ...existingSettings.financial,
        ...financial
      };
    }
    if (notifications) {
      existingSettings.notifications = {
        ...existingSettings.notifications,
        ...notifications
      };
    }
    if (security) {
      existingSettings.security = {
        ...existingSettings.security,
        ...security
      };
    }

    existingSettings.updatedAt = new Date();
    await existingSettings.save();

    // Update Clinic model partially (keep old values if not provided)
    const clinicDoc = await Clinic.findById(clinicId);
    if (clinicDoc && clinic) {
      clinicDoc.name = clinic.name || clinicDoc.name;
      clinicDoc.contact = {
        phone: clinic.phone || clinicDoc.contact.phone,
        email: clinic.email || clinicDoc.contact.email,
        website: clinic.website ?? clinicDoc.contact.website
      };

      if (clinic.address) {
        clinicDoc.address = {
          street: clinic.address.street || clinicDoc.address.street,
          city: clinic.address.city || clinicDoc.address.city,
          state: clinic.address.state || clinicDoc.address.state,
          zipCode: clinic.address.zipCode || clinicDoc.address.zipCode,
          country: clinic.address.country || clinicDoc.address.country
        };
      }
      await clinicDoc.save();
    }

    // Update working hours in Clinic model
    if (clinicDoc && workingHours) {
      for (const day in workingHours) {
        const daySchedule = workingHours[day];
        if (clinicDoc.settings.working_hours[day]) {
          clinicDoc.settings.working_hours[day] = {
            start: daySchedule.start || clinicDoc.settings.working_hours[day].start,
            end: daySchedule.end || clinicDoc.settings.working_hours[day].end,
            isWorking: daySchedule.isOpen ?? clinicDoc.settings.working_hours[day].isWorking
          };
        }
      }
      await clinicDoc.save();
    }

    console.log(`✅ Settings updated partially for clinic: ${clinicId}`);

    return res.json({
      success: true,
      message: 'Settings updated successfully',
      data: existingSettings.toJSON(),
    });

  } catch (error) {
    console.error('Error updating settings:', error);

    if (error instanceof Error && error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid data provided',
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update settings',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};



export default {
  getSettings,
  updateSettings,
}; 